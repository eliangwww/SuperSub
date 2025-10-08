import { userAgents } from './constants';
export const fetchWithTimeout = (url: string, options: RequestInit, timeout: number): Promise<Response> => {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;
    options.signal = signal;

    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeout);

    fetch(url, options)
      .then(response => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch(error => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
};
export const fetchSubscriptionContent = async (url: string, timeoutSeconds: number = 10): Promise<{ success: true, content: string } | { success: false, error: string }> => {
    const controller = new AbortController();
    const timeoutMs = timeoutSeconds * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)] },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const content = await response.text();
            if (content) {
                return { success: true, content };
            } else {
                return { success: false, error: 'Subscription content is empty.' };
            }
        } else {
            return { success: false, error: `Failed to fetch subscription: Status ${response.status}` };
        }
    } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
            return { success: false, error: `Subscription timed out after ${timeoutSeconds} seconds.` };
        } else {
            return { success: false, error: `Failed to process subscription: ${e.message}` };
        }
    }
};