import http from 'node:http';

export interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  vipTier: 'Standard' | 'Silver' | 'Gold VIP' | 'Platinum';
  createdAt: number;
}

export interface UserPreferences {
  dietary: Array<'Vegetarian' | 'Vegan' | 'Gluten-Free' | 'Halal' | 'Spicy Lover'>;
  mobility: {
    preferredTier: string;
    preferredTierName: string;
    ecoFriendlyOnly: boolean;
    quietRide: boolean;
  };
  ui: {
    theme: 'light' | 'dark' | 'system';
    denseMode: boolean;
    accentColor: string;
  };
  conciergeTone: 'concise' | 'friendly' | 'formal' | 'vip';
}

export let currentProfile: UserProfile = {
  userId: 'usr_bassem_42',
  username: 'bassem',
  displayName: 'Bassem Zohdy',
  email: 'bassem.zohdy@gmail.com',
  avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bassem',
  vipTier: 'Gold VIP',
  createdAt: Date.now() - 86400000 * 30,
};

export let currentPreferences: UserPreferences = {
  dietary: ['Vegetarian', 'Spicy Lover'],
  mobility: {
    preferredTier: 'drv_3',
    preferredTierName: 'Tesla Model Y (EV)',
    ecoFriendlyOnly: true,
    quietRide: true,
  },
  ui: {
    theme: 'system',
    denseMode: false,
    accentColor: '#2563eb',
  },
  conciergeTone: 'vip',
};

export function generatePromptContext(profile: UserProfile, prefs: UserPreferences): string {
  const dietaryStr = prefs.dietary.length > 0 ? prefs.dietary.join(', ') : 'None';
  return `USER PROFILE CONTEXT:
- Name: ${profile.displayName} (${profile.vipTier} Member)
- Dietary Restrictions: ${dietaryStr}
- Mobility Preference: ${prefs.mobility.preferredTierName} (Eco-friendly: ${prefs.mobility.ecoFriendlyOnly ? 'Yes' : 'No'})
- Tone: ${prefs.conciergeTone.toUpperCase()} Concierge
INSTRUCTIONS:
1. When generating food options, prioritize and prominently badge dishes matching the user's dietary preferences (${dietaryStr}).
2. When generating ride options, highlight the user's preferred vehicle (${prefs.mobility.preferredTierName}).
3. Acknowledge the user's ${profile.vipTier} status in greetings.`;
}

export function executeProfileRequest(
  method: string,
  pathname: string,
  query: Record<string, string> = {},
  body: any = {}
): { status: number; data: any } {
  const normMethod = method.toUpperCase();

  // 1. Healthcheck
  if (normMethod === 'GET' && pathname === '/health') {
    return {
      status: 200,
      data: {
        status: 'ok',
        service: 'service-profile',
        port: 4005,
        user: currentProfile.username,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // 2. Get Profile
  if (normMethod === 'GET' && pathname === '/profile') {
    return {
      status: 200,
      data: {
        success: true,
        profile: currentProfile,
      },
    };
  }

  // 3. Get Preferences
  if (normMethod === 'GET' && pathname === '/profile/preferences') {
    return {
      status: 200,
      data: {
        success: true,
        preferences: currentPreferences,
      },
    };
  }

  // 4. Update Preferences
  if (normMethod === 'POST' && pathname === '/profile/preferences') {
    if (body.dietary && Array.isArray(body.dietary)) {
      currentPreferences.dietary = body.dietary;
    }
    if (body.mobility && typeof body.mobility === 'object') {
      currentPreferences.mobility = { ...currentPreferences.mobility, ...body.mobility };
    }
    if (body.ui && typeof body.ui === 'object') {
      currentPreferences.ui = { ...currentPreferences.ui, ...body.ui };
    }
    if (body.conciergeTone) {
      currentPreferences.conciergeTone = body.conciergeTone;
    }

    return {
      status: 200,
      data: {
        success: true,
        message: 'Preferences updated successfully',
        preferences: currentPreferences,
        promptContext: generatePromptContext(currentProfile, currentPreferences),
      },
    };
  }

  // 5. Dynamic Prompt Context for Agent Core / LLM
  if (normMethod === 'GET' && pathname === '/profile/prompt-context') {
    return {
      status: 200,
      data: {
        success: true,
        promptContext: generatePromptContext(currentProfile, currentPreferences),
        profile: currentProfile,
        preferences: currentPreferences,
      },
    };
  }

  // 6. MCP Protocol Endpoint
  if (normMethod === 'GET' && pathname === '/mcp') {
    return {
      status: 200,
      data: {
        protocol: 'mcp-1.0',
        service: 'service-profile',
        tools: [
          {
            name: 'profile_getProfile',
            description: 'Fetch authenticated user profile, tier, and avatar',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'profile_getPreferences',
            description: 'Fetch dietary, mobility, and UI theme preferences',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'profile_updatePreferences',
            description: 'Update user preferences dynamically',
            parameters: {
              type: 'object',
              properties: {
                dietary: { type: 'array', items: { type: 'string' } },
                mobility: { type: 'object' },
                ui: { type: 'object' },
                conciergeTone: { type: 'string' },
              },
            },
          },
          {
            name: 'profile_getPromptContext',
            description: 'Fetch personalized system prompt instructions to guide agent UI generation',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    };
  }

  return { status: 404, data: { error: 'Not found', path: pathname } };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  if (method === 'POST') {
    let bodyText = '';
    req.on('data', (chunk) => (bodyText += chunk));
    req.on('end', () => {
      try {
        const body = bodyText ? JSON.parse(bodyText) : {};
        const result = executeProfileRequest(method, url.pathname, query, body);
        sendJson(res, result.status, result.data);
      } catch (e: any) {
        sendJson(res, 400, { error: 'Invalid JSON body', details: e.message });
      }
    });
  } else {
    const result = executeProfileRequest(method, url.pathname, query);
    sendJson(res, result.status, result.data);
  }
});

const PORT = parseInt(process.env.PORT || '4005', 10);
if (process.argv[1]?.endsWith('service-profile/src/index.ts')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`👤 User Profile Microservice listening on port ${PORT}`);
  });
}

