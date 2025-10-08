import { Buffer } from 'node:buffer';
import type { Env, AppContext } from '../utils/types';
import { Hono } from 'hono';
import { userAgents, parseSubscriptionContent, applySubscriptionRules } from './subscriptions';
import { generateProfileNodes } from './profiles';
import { regenerateLink } from '../../../src/utils/nodeParser';
import { sendTelegramMessage } from '../utils/telegram';

const publicRoutes = new Hono<AppContext>();

// This is the main subscription route
publicRoutes.get('/:sub_token/:profile_alias', async (c) => {
    const { sub_token, profile_alias } = c.req.param();

    // 1. Find user by sub_token
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE sub_token = ?').bind(sub_token).first<any>();
    if (!user) {
        return c.text('Invalid subscription token', 404);
    }

    // 2. Find profile by alias and user_id
    const profile = await c.env.DB.prepare('SELECT * FROM profiles WHERE (id = ? OR alias = ?) AND user_id = ?').bind(profile_alias, profile_alias, user.id).first<any>();
    if (!profile) {
        return c.text('Profile not found', 404);
    }

    let format = 'Unknown';
    // Send Telegram notification
    try {
        const userAgent = c.req.header('user-agent') || 'N/A';
        const ip = c.req.header('cf-connecting-ip') || 'N/A';
        const cf = c.req.raw.cf as any;

        const country = cf?.country || 'N/A';
        const city = cf?.city || 'N/A';
        const isp = cf?.asOrganization || 'N/A';
        const asn = `AS${cf?.asn || 'N/A'}`;
        
        const domain = new URL(c.req.url).hostname;
        
        let client = userAgent; // Default to full user-agent
        const uaLower = userAgent.toLowerCase();

        if (uaLower.includes('clash')) {
            client = userAgent.match(/clash-verge\/[v\d.]+|clash-meta\/[v\d.]+|clash\/[v\d.]+/i)?.[0] || client;
            format = 'clash';
        } else if (uaLower.includes('surge')) {
            client = userAgent.match(/surge\/[v\d.]+/i)?.[0] || client;
            format = 'surge';
        } else if (uaLower.includes('quantumult')) {
            client = userAgent.match(/quantumult%20x\/[v\d.]+|quantumult\/[v\d.]+/i)?.[0] || client;
            format = 'quantumult';
        } else if (uaLower.includes('sing-box')) {
            client = userAgent.match(/sing-box\/[v\d.]+/i)?.[0] || client;
            format = 'sing-box';
        }
        
        // Default to base64 if no specific client is detected (e.g., browser access)
        if (format === 'Unknown') {
            format = 'base64';
        }

        const now = new Date(new Date().getTime() + 8 * 3600 * 1000);
        const time = now.toISOString().replace('T', ' ').substring(0, 19);

        const message = [
            `🚀 <b>订阅被访问</b>`,
            ``,
            `<b>IP 地址:</b> ${ip}`,
            `<b>国家:</b> ${country}`,
            `<b>城市:</b> ${city}`,
            `<b>ISP:</b> ${isp}`,
            `<b>ASN:</b> ${asn}`,
            ``,
            `<b>域名:</b> ${domain}`,
            `<b>客户端:</b> ${client}`,
            `<b>请求格式:</b> ${format}`,
            `<b>订阅组:</b> ${profile.name}`,
            ``,
            `<b>时间:</b> ${time} (UTC+8)`
        ].join('\n');

        await sendTelegramMessage(c.env, profile.user_id, message);
    } catch (error: any) {
        console.error(`Failed to send Telegram notification: ${error.message}`);
    }

    try {
        const content = JSON.parse(profile.content || '{}');
        const userId = profile.user_id;

    // When generating nodes for a public subscription link (even for subconverter), it's a real use, not a dry run.
    // So, isDryRun should be false to update the polling index.
    const allNodes = await generateProfileNodes(c.env, c.executionCtx, profile, false);

    if (allNodes.length === 0) {
        return c.text('No nodes found for this profile.', 404);
    }

        const userAgent = c.req.header('User-Agent') || '';
        const query = c.req.query();
        const regeneratedLinks = allNodes.map(regenerateLink).filter(Boolean).join('\n');

        // If the request asks for base64, return it directly. This is for subconverter to fetch.
        if (query.b64) {
            const base64Content = Buffer.from(regeneratedLinks, 'utf-8').toString('base64');
            return c.text(base64Content);
        }

        // 1. Determine target client from UA and query parameters
        let targetClient = 'base64'; // Default to base64
        if (query.clash) targetClient = 'clash';
        if (query.singbox || query.sb) targetClient = 'singbox';
        if (query.surge) targetClient = 'surge';
        if (query.v2ray) targetClient = 'v2ray';

        // If no query param, try to detect from User-Agent
        if (targetClient === 'base64') {
            const { results: uaMappings } = await c.env.DB.prepare('SELECT ua_keyword, client_type FROM ua_mappings WHERE is_enabled = 1').all<{ ua_keyword: string; client_type: string; }>();
            for (const mapping of uaMappings) {
                if (userAgent.toLowerCase().includes(mapping.ua_keyword.toLowerCase())) {
                    targetClient = mapping.client_type;
                    break;
                }
            }
        }
        
        // 2. Handle generation based on mode and target
        if (content.generation_mode === 'online' && targetClient !== 'base64') {
            // Online conversion for specific clients (Clash, Sing-box, etc.)
            const backend = await c.env.DB.prepare("SELECT url FROM subconverter_assets WHERE id = ?").bind(content.subconverter_backend_id).first<{ url: string }>();
            const config = await c.env.DB.prepare("SELECT url FROM subconverter_assets WHERE id = ?").bind(content.subconverter_config_id).first<{ url: string }>();

            if (!backend || !config) {
                return c.text('Subconverter backend or config not found.', 500);
            }

            // Construct the URL for subconverter to fetch from us
            const currentUrl = new URL(c.req.url);
            currentUrl.searchParams.set('b64', '1'); // Add flag to get base64 on the recursive call

            const targetUrl = new URL(`${backend.url}/sub`);
            targetUrl.searchParams.set('target', targetClient);
            targetUrl.searchParams.set('url', `${currentUrl.toString()}&_t=${Date.now()}`); // Pass our own URL with a timestamp
            targetUrl.searchParams.set('config', config.url);
            targetUrl.searchParams.set('filename', profile.name);

            try {
                const subResponse = await fetch(targetUrl.toString(), { headers: { 'User-Agent': userAgent } });
                if (!subResponse.ok) {
                    const errorText = await subResponse.text();
                    console.error(`Subconverter request failed with status ${subResponse.status}:`, errorText);
                    return c.text(`Failed to generate from subconverter: ${errorText}`, 502);
                }
                const finalConfig = await subResponse.text();
                return c.text(finalConfig);
            } catch (err: any) {
                console.error("Fetch to subconverter failed:", err);
                return c.text(`Failed to connect to subconverter backend: ${err.message}`, 502);
            }
        } else {
            // Local generation (base64) for browsers or when online mode is off
            const base64Content = Buffer.from(regeneratedLinks, 'utf-8').toString('base64');
            if (format === 'Unknown') {
                format = 'base64';
            }
            return c.text(base64Content);
        }

    } catch (e: any) {
        console.error(`Error generating profile for ${profile_alias}:`, e);
        return c.text(`Internal server error: ${e.message}`, 500);
    }
});

export default publicRoutes;