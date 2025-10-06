import { Buffer } from 'node:buffer';
import type { Env, AppContext } from '../utils/types';
import { Hono } from 'hono';
import { userAgents, parseSubscriptionContent, applySubscriptionRules } from './subscriptions';
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

    let allNodes: any[] = [];

    if (content.subscription_ids && content.subscription_ids.length > 0) {
        const subPlaceholders = content.subscription_ids.map(() => '?').join(',');
        const { results: subscriptions } = await c.env.DB.prepare(`SELECT id, name, url FROM subscriptions WHERE id IN (${subPlaceholders}) AND user_id = ?`).bind(...content.subscription_ids, userId).all<{ id: string; name: string; url: string; }>();

        for (const sub of subscriptions) {
            try {
                const response = await fetch(sub.url, { headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] } });
                if (response.ok) {
                    const subContent = await response.text();
                    let nodes = parseSubscriptionContent(subContent);

                    const { results: rules } = await c.env.DB.prepare('SELECT * FROM subscription_rules WHERE subscription_id = ? AND user_id = ? AND enabled = 1 ORDER BY sort_order ASC').bind(sub.id, userId).all();
                    if (rules && rules.length > 0) {
                        nodes = applySubscriptionRules(nodes, rules);
                    }
                    const nodesWithSubName = nodes.map(node => ({ ...node, subscriptionName: sub.name }));
                    allNodes.push(...nodesWithSubName);
                }
            } catch (e: any) {
                console.error(`Failed to process subscription ${sub.id}:`, e);
            }
        }
    }

        if (content.node_ids && content.node_ids.length > 0) {
            const nodePlaceholders = content.node_ids.map(() => '?').join(',');
            const manualNodesQuery = `
                SELECT n.*, g.name as group_name
                FROM nodes n
                LEFT JOIN node_groups g ON n.group_id = g.id
                WHERE n.id IN (${nodePlaceholders}) AND n.user_id = ?
            `;
            const { results: manualNodes } = await c.env.DB.prepare(manualNodesQuery).bind(...content.node_ids, userId).all<any>();
            
            const parsedManualNodes = manualNodes.map(n => ({
                id: n.id,
                name: n.name,
                protocol: n.protocol,
                server: n.server,
                port: n.port,
                protocol_params: JSON.parse(n.protocol_params || '{}'),
                link: n.link,
                raw: n.link,
                group_name: n.group_name, // Keep group name for prefixing
            }));

            const taggedManualNodes = parsedManualNodes.map(node => ({ ...node, isManual: true }));
            allNodes.push(...taggedManualNodes);
        }

        if (allNodes.length === 0) {
            return c.text('No nodes found for this profile.', 404);
        }

        const prefixSettings = content.node_prefix_settings || {};
        if (prefixSettings.enable_subscription_prefix || prefixSettings.manual_node_prefix || prefixSettings.enable_group_name_prefix) {
            allNodes = allNodes.map(node => {
                // Subscription prefix logic (unchanged)
                if (prefixSettings.enable_subscription_prefix && node.subscriptionName) {
                    return { ...node, name: `${node.subscriptionName} - ${node.name}` };
                }

                // Manual node prefixing logic (new priority)
                if (node.isManual) {
                    if (prefixSettings.enable_group_name_prefix && node.group_name) {
                        return { ...node, name: `${node.group_name} - ${node.name}` };
                    }
                    if (prefixSettings.manual_node_prefix) {
                        return { ...node, name: `${prefixSettings.manual_node_prefix} - ${node.name}` };
                    }
                }
                
                return node;
            });
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
            targetUrl.searchParams.set('url', currentUrl.toString()); // Pass our own URL
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