export const config = {
    runtime: 'edge'
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const { location, radius, startDate, endDate, category, priceFilter, language = 'en' } = await req.json();

        if (!location || !startDate || !endDate) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const categoryFilter = category && category !== 'all' 
            ? `Focus specifically on ${category} events and activities.` 
            : 'Include a variety of event types.';

        const radiusText = radius > 0 
            ? `within ${radius} kilometers of ${location}` 
            : `in ${location}`;

        let priceFilterText = '';
        if (priceFilter && priceFilter.length > 0) {
            const priceDescriptions = priceFilter.map(p => {
                if (p === 'free') return 'free events';
                if (p === 'cheap') return 'events under 20€';
                if (p === 'medium') return 'events between 20-50€';
                if (p === 'expensive') return 'events over 50€';
                return '';
            }).filter(Boolean).join(' or ');
            priceFilterText = `Prioritize ${priceDescriptions}.`;
        }

        const languageNames = {
            'en': 'English',
            'de': 'German',
            'es': 'Spanish',
            'it': 'Italian'
        };
        const outputLanguage = languageNames[language] || 'English';

        let durationFilterText = '';
        if (req.body && req.body.durationFilter && req.body.durationFilter.length > 0) {
            const durationFilter = req.body.durationFilter;
            const durationDescriptions = durationFilter.map(d => {
                if (d === 'short') return 'activities under 1 hour';
                if (d === 'medium') return 'activities 1-3 hours';
                if (d === 'halfday') return 'half-day activities (3-5 hours)';
                if (d === 'fullday') return 'full-day activities (5+ hours)';
                return '';
            }).filter(Boolean).join(' or ');
            durationFilterText = `Prioritize ${durationDescriptions}.`;
        }

        const prompt = `You are an expert local events guide. Find what's happening ${radiusText} between ${startDate} and ${endDate}.

${categoryFilter}
${priceFilterText}
${durationFilterText}

IMPORTANT: Respond in ${outputLanguage}.

Return a JSON object with TWO separate arrays:

1. "events" - REAL scheduled events (concerts, festivals, markets, sports matches, exhibitions, shows, etc.)
2. "activities" - General things to do anytime (tourist attractions, hiking spots, beaches, museums, restaurants, viewpoints, etc.)

Use this exact structure:
{
    "events": [
        {
            "title": "Event Name",
            "dateStart": "Month Date, Year",
            "dateEnd": "Month Date, Year or null if single day",
            "time": "Morning|Afternoon|Evening|Night|All day",
            "location": "Specific venue or address",
            "category": "festivals|concerts|markets|sports|culture|nightlife|food|family|outdoor",
            "description": "Brief 1-2 sentence description",
            "price": "free|cheap|medium|expensive",
            "priceEstimate": "Free" or "~15€" or "20-40€" etc,
            "link": "Official ticket website or organizer URL - MUST be a real working URL or null",
            "duration": "1-2 hours" or "Half day" or "Full day" etc
        }
    ],
    "activities": [
        {
            "title": "Activity Name",
            "location": "Place or area",
            "category": "culture|outdoor|food|family|nightlife",
            "description": "Brief 1-2 sentence description of why to visit",
            "price": "free|cheap|medium|expensive",
            "priceEstimate": "Free" or "~10€" etc,
            "link": "Official website URL - MUST be a real working URL or null",
            "duration": "30 min" or "1-2 hours" or "2-3 hours" or "Half day" or "Full day"
        }
    ]
}

CRITICAL RULES:
- For recurring events (like Christmas markets that run multiple days), list them ONLY ONCE with dateStart and dateEnd showing the full range
- Do NOT create separate entries for each day of a recurring event
- time should be: "Morning" (6-12), "Afternoon" (12-17), "Evening" (17-22), "Night" (22+), or "All day"
- Do NOT use specific times like "11:00" unless it's a specific event start time
- PRICE ACCURACY IS CRITICAL:
  * Public parks, walking around, window shopping, beaches = ALWAYS "Free"
  * Christmas markets entrance = "Free" (food/drinks cost extra but entrance is free)
  * Museums often have entry fees, research typical prices
  * Only use "Free" when it's actually free to enter/attend
- For links: Only include REAL official URLs you are confident about. Use null if unsure.
- duration: Estimate how long the activity/event typically takes
- Return 8-15 unique events and 5-10 activities
- Only return the JSON, no other text`;

        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'API key not configured' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
                })
            }
        );

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.text();
            console.error('Gemini API error:', errorData);
            return new Response(JSON.stringify({ error: 'AI service error', details: errorData }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const geminiData = await geminiResponse.json();
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let events = [];
        let activities = [];
        
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                events = parsed.events || [];
                activities = parsed.activities || [];
            }
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
        }

        return new Response(JSON.stringify({ events, activities }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error) {
        console.error('API error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
