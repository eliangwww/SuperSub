import { Node } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// Define a more specific type for a node that has been parsed but not yet saved to the DB.
export type ParsedNode = Omit<Node, 'id' | 'user_id' | 'group_id' | 'created_at' | 'updated_at' | 'sort_order' | 'status' | 'latency' | 'last_checked' | 'error'>;


// A simple Base64 decoder that works in both browser and Node.js environments
const base64Decode = (str: string): string => {
  try {
    // Modern browsers have atob, but it can't handle UTF-8 characters.
    // A common trick is to use a sequence of URI-encoding and decoding to handle all characters.
    const decoded = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return decodeURIComponent(
      Array.prototype.map
        .call(decoded, (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch (e) {
    console.error('Failed to decode base64 string:', str, e);
    // Fallback for non-browser environments or if the above fails
    try {
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(str, 'base64').toString('utf-8');
        }
    } catch (bufferError) {
        console.error('Buffer decoding also failed:', bufferError);
    }
    return ''; // Return empty string if all methods fail
  }
};

const parseVmess = (link: string): ParsedNode | null => {
  if (!link.startsWith('vmess://')) return null;

  try {
    const encodedData = link.substring(8);
    const decodedJson = base64Decode(encodedData);
    const config = JSON.parse(decodedJson);

    if (!config.add || !config.port || !config.id) return null;
    
    const protocol_params = { ...config };
    delete protocol_params.ps; // This is the 'name'

    return {
      name: config.ps || `${config.add}:${config.port}`,
      link: link,
      protocol: 'vmess',
      protocol_params: protocol_params,
      // Legacy fields for compatibility
      server: config.add,
      port: Number(config.port),
      type: 'vmess',
      password: config.id,
      params: protocol_params,
    };
  } catch (error) {
    console.error('Failed to parse VMess link:', link, error);
    return null;
  }
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