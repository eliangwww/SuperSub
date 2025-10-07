import { Node } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// Define a more specific type for a node that has been parsed but not yet saved to the DB.
export type ParsedNode = Omit<Node, 'id' | 'user_id' | 'group_id' | 'created_at' | 'updated_at' | 'sort_order' | 'status' | 'latency' | 'last_checked' | 'error'>;


// A robust Base64 decoder that handles URL-safe encoding and padding issues.
const base64Decode = (str: string): string => {
    let output = str.replace(/-/g, '+').replace(/_/g, '/');
    switch (output.length % 4) {
        case 0:
            break;
        case 2:
            output += '==';
            break;
        case 3:
            output += '=';
            break;
        default:
            throw new Error('Illegal base64url string!');
    }

    try {
        // Use atob for browser environments, which is faster.
        // The decodeURIComponent trick handles UTF-8 characters correctly.
        const decoded = atob(output);
        return decodeURIComponent(
            Array.prototype.map
                .call(decoded, (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
        );
    } catch (e) {
        console.error('Failed to decode base64 string with atob:', str, e);
        // Fallback to Buffer for Node.js environments or if atob fails.
        try {
            if (typeof Buffer !== 'undefined') {
                return Buffer.from(output, 'base64').toString('utf-8');
            }
        } catch (bufferError) {
            console.error('Buffer decoding also failed:', bufferError);
        }
        return ''; // Return empty string if all methods fail.
    }
};

const parseVmess = (link: string): ParsedNode | null => {
    if (!link.startsWith('vmess://')) return null;

    const data = link.substring(8);

    // Strategy 1: Check for URL-like format (contains '@')
    if (data.includes('@')) {
        try {
            const atIndex = data.lastIndexOf('@');
            const credentials = data.substring(0, atIndex);
            const serverPart = data.substring(atIndex + 1);

            // Reconstruct a parsable URL. The protocol doesn't matter as much as the structure.
            const parsableLink = `vmess://${serverPart}`;
            const url = new URL(parsableLink);

            const [method, uuid] = credentials.split(':');
            if (!uuid) throw new Error('Invalid VMess credentials format.');

            const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
            const server = url.hostname;
            const port = Number(url.port);

            if (!server || !port) return null;

            const protocol_params: Record<string, any> = {
                id: uuid,
                security: method,
            };
            for (const [key, value] of url.searchParams.entries()) {
                protocol_params[key] = value;
            }
            
            // Standardize common parameters
            protocol_params.add = server;
            protocol_params.port = port;
            protocol_params.aid = protocol_params.alterId || '0';
            protocol_params.net = protocol_params.obfs || 'tcp';
            protocol_params.type = 'none';
            protocol_params.host = protocol_params.obfsParam || '';
            protocol_params.path = protocol_params.path || '';
            protocol_params.tls = protocol_params.tls === '1' || protocol_params.tls === 'tls' ? 'tls' : '';

            return {
                name,
                link,
                protocol: 'vmess',
                protocol_params,
                server,
                port,
                type: 'vmess',
                password: uuid,
                params: protocol_params,
            };
        } catch (error) {
            console.error('Failed to parse VMess URL-like format:', link, error);
            return null; // If it has '@' but fails parsing, it's likely invalid.
        }
    }
    
    // Strategy 2: Treat as Base64-encoded JSON (legacy format)
    try {
        const decodedJson = base64Decode(data);
        if (!decodedJson) return null; // Stop if decoding fails

        const config = JSON.parse(decodedJson);

        if (config.add && config.port && config.id) {
            const protocol_params = { ...config };
            delete protocol_params.ps; // 'ps' is the remarks/name

            return {
                name: config.ps || `${config.add}:${config.port}`,
                link: link,
                protocol: 'vmess',
                protocol_params: protocol_params,
                server: config.add,
                port: Number(config.port),
                type: 'vmess',
                password: config.id, // UUID
                params: protocol_params,
            };
        }
    } catch (error) {
        console.error('Failed to parse VMess Base64 format:', link, error);
        return null;
    }

    // If neither strategy works, return null.
    console.error('Failed to parse VMess link with any strategy:', link);
    return null;
};

const parseHysteria2 = (link: string): ParsedNode | null => {
    if (!link.startsWith('hysteria2://')) return null;
    try {
        const url = new URL(link);
        const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
        const server = url.hostname;
        const port = Number(url.port);
        const auth = url.username; // Hy2 auth is in the username part

        if (!auth || !server || !port) return null;

        const protocol_params: Record<string, any> = {};
        for (const [key, value] of url.searchParams.entries()) {
            protocol_params[key] = value;
        }
        
        // Also add auth to params for completeness
        protocol_params.auth = auth;

        return {
            name,
            link,
            protocol: 'hysteria2',
            protocol_params,
            // Legacy fields
            server,
            port,
            type: 'hysteria2',
            password: auth,
            params: protocol_params,
        };
    } catch (error) {
        console.error('Failed to parse Hysteria2 link:', link, error);
        return null;
    }
};


const genericUrlParser = (link: string, protocol: 'ss' | 'trojan' | 'vless' | 'tuic'): ParsedNode | null => {
    if (!link.startsWith(`${protocol}://`)) return null;

    try {
        const url = new URL(link);
        const name = decodeURIComponent(url.hash.substring(1)) || url.hostname;
        const server = url.hostname;
        const port = Number(url.port);
        let password = url.username;
        let uuid = '';

        if (!server || !port) return null;

        const protocol_params: Record<string, any> = {};
        for (const [key, value] of url.searchParams.entries()) {
            protocol_params[key] = value;
        }

        if (protocol === 'ss') {
            // ss://<base64(method:pass)>@host:port#name
            try {
                const decodedUsername = decodeURIComponent(url.username);
                const decodedCredentials = base64Decode(decodedUsername);
                const [method, pass] = decodedCredentials.split(':');
                if (!method || !pass) return null;
                protocol_params.method = method;
                password = pass;
            } catch (e) {
                console.error('Failed to parse SS credentials', e);
                return null;
            }
        } else if (protocol === 'tuic') {
            // tuic://<uuid>:<password>@host:port?sni=...
            const credentials = url.username.split(':');
            uuid = credentials[0];
            password = credentials[1] || '';
            protocol_params.uuid = uuid;
        }
        
        if (!password && protocol !== 'ss') {
            // For vless and trojan, password/uuid is in username
            password = url.username;
            if (!password) return null;
        }
        if (protocol === 'tuic' && !uuid) return null;


        return {
            name,
            link,
            protocol,
            protocol_params,
            // Legacy fields
            server,
            port,
            type: protocol,
            password,
            params: protocol_params,
        };

    } catch (error) {
        console.error(`Failed to parse ${protocol} link:`, link, error);
        return null;
    }
}


export const parseNodeLinks = (linksText: string): (ParsedNode & { id: string; raw: string; })[] => {
  if (!linksText) {
    return [];
  }

  const links = linksText.split(/[\r\n]+/).map(link => link.trim()).filter(Boolean);
  const parsedNodes: (ParsedNode & { id: string; raw: string; })[] = [];

  for (const link of links) {
    let parsedNode: ParsedNode | null = null;

    if (link.startsWith('vmess://')) {
      parsedNode = parseVmess(link);
    } else if (link.startsWith('ss://')) {
      parsedNode = genericUrlParser(link, 'ss');
    } else if (link.startsWith('trojan://')) {
      parsedNode = genericUrlParser(link, 'trojan');
    } else if (link.startsWith('vless://')) {
      parsedNode = genericUrlParser(link, 'vless');
    } else if (link.startsWith('hysteria2://')) {
      parsedNode = parseHysteria2(link);
    } else if (link.startsWith('tuic://')) {
      parsedNode = genericUrlParser(link, 'tuic');
    }

    if (parsedNode) {
      // Assign a temporary client-side ID for UI keying purposes
      const nodeWithId = { ...parsedNode, id: uuidv4(), raw: link };
      parsedNodes.push(nodeWithId);
    }
  }

  return parsedNodes;
};

// A simple Base64 encoder that works in both browser and Node.js environments
const base64Encode = (str: string): string => {
    try {
        // For browser environments
        if (typeof btoa !== 'undefined') {
            return btoa(unescape(encodeURIComponent(str)));
        }
        // For Node.js environments
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(str, 'utf-8').toString('base64');
        }
        return ''; // Fallback
    } catch (e) {
        console.error('Failed to encode to base64:', e);
        return '';
    }
};


export const regenerateLink = (node: ParsedNode): string => {
    const protocol = node.protocol;
    const name = encodeURIComponent(node.name);

    switch (protocol) {
        case 'vmess':
            const vmessConfig = { ...node.protocol_params, ps: node.name };
            return `vmess://${base64Encode(JSON.stringify(vmessConfig))}`;
        
        case 'ss':
            const credentials = `${node.protocol_params.method}:${node.password}`;
            const encodedCredentials = base64Encode(credentials).replace(/=/g, ''); // Some clients don't like padding
            return `ss://${encodedCredentials}@${node.server}:${node.port}#${name}`;

        case 'trojan':
        case 'vless':
            const trojanUrl = new URL(`${protocol}://${node.password}@${node.server}:${node.port}`);
            trojanUrl.hash = name;
            for (const key in node.protocol_params) {
                trojanUrl.searchParams.set(key, node.protocol_params[key]);
            }
            return trojanUrl.toString();

        case 'hysteria2':
            const hy2Url = new URL(`hysteria2://${node.password}@${node.server}:${node.port}`);
            hy2Url.hash = name;
            for (const key in node.protocol_params) {
                if (key !== 'auth') { // Auth is already in the userinfo part
                    hy2Url.searchParams.set(key, node.protocol_params[key]);
                }
            }
            return hy2Url.toString();
        
        case 'tuic':
            const tuicUrl = new URL(`tuic://${node.protocol_params.uuid}:${node.password}@${node.server}:${node.port}`);
            tuicUrl.hash = name;
            for (const key in node.protocol_params) {
                if (key !== 'uuid') {
                    tuicUrl.searchParams.set(key, node.protocol_params[key]);
                }
            }
            return tuicUrl.toString();

        default:
            return node.link || ''; // Fallback to original link
    }
};