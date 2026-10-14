import { apiFetch } from '../lib/client-api';
import { supportText, readSupportAssistantResponse, type SupportTransport, type SupportMessage, type SupportAssistantCapability, type SupportTicket } from '../lib/support';

export function supportTransport(
  db: any,
  actor: () => string = () => '',
  assistantRequest?: (path: string, init: RequestInit) => Promise<Response>
): SupportTransport {
  let activeReceive: ((snapshot: { messages: SupportMessage[]; handoffRequested: boolean; hasOlder: boolean }) => void) | null = null;
  return {
    async assistantCapability() {
      if (!assistantRequest) {
        return {
          available: false,
          reason: 'security_backend_required',
          knowledgeVersion: '',
          requiredServices: ['Trusted ORIN API with enforced sessions and MFA', 'Self-hosted inference service']
        } as SupportAssistantCapability;
      }
      try {
        const r = await assistantRequest('/api/support/assistant', { method: 'GET', signal: AbortSignal.timeout(18000) });
        if (!r.ok) throw new Error('Assistant unavailable');
        return (await r.json()) as SupportAssistantCapability;
      } catch {
        return {
          available: false,
          reason: 'security_backend_required',
          knowledgeVersion: '',
          requiredServices: []
        } as SupportAssistantCapability;
      }
    },
    async askAssistant(messageId, options = {}) {
      if (!assistantRequest) return { status: 'unavailable' };
      const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, 55000);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      try {
        const r = await assistantRequest('/api/support/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ messageId }),
          signal: controller.signal
        });
        return await readSupportAssistantResponse(r, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
      }
    },
    watchThreads(receive, fail) {
      let active = true;
      const poll = async () => {
        if (!active) return;
        try {
          const res = await apiFetch('/api/admin/support/threads');
          if (res.ok) {
            const data = await res.json();
            receive(data.threads || []);
          }
        } catch (e: any) {
          fail?.(e);
        }
      };
      void poll();
      const timer = setInterval(poll, 10000);
      return () => { active = false; clearInterval(timer); };
    },
    async reply(uid, id, body) {
      const text = supportText(body);
      const res = await apiFetch('/api/admin/support/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, id, text })
      });
      if (!res.ok) throw new Error('Reply failed');
    },
    watch(uid, receive, connection) {
      activeReceive = receive;
      let active = true;
      const poll = async () => {
        if (!active) return;
        try {
          const res = await apiFetch('/api/support/messages');
          if (res.ok) {
            const data = await res.json();
            const msgs: SupportMessage[] = (data.messages || []).map((m: any) => ({
              id: m.id,
              text: m.text,
              kind: m.kind,
              senderId: m.senderId,
              createdAt: m.createdAt || Date.now(),
              ...(m.assistant ? { assistant: m.assistant } : {})
            }));
            receive({ messages: msgs, handoffRequested: !!data.handoffRequested, hasOlder: false });
            connection('connected');
          } else {
            connection('unavailable');
          }
        } catch {
          connection('offline');
        }
      };
      void poll();
      const timer = setInterval(poll, 5000);
      return () => {
        active = false;
        clearInterval(timer);
        if (activeReceive === receive) activeReceive = null;
      };
    },
    async send(uid, id, body) {
      const text = supportText(body);
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid message ID');
      const res = await apiFetch('/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to send message');
      }
      const data = await res.json().catch(() => null);
      if (data && activeReceive) {
        const msgs: SupportMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          text: m.text,
          kind: m.kind,
          senderId: m.senderId,
          createdAt: m.createdAt || Date.now(),
          ...(m.assistant ? { assistant: m.assistant } : {})
        }));
        activeReceive({ messages: msgs, handoffRequested: !!data.handoffRequested, hasOlder: false });
      }
    },
    async handoff(uid, messageId) {
      if (!uid) throw new Error('Support ticket service has not been connected.');
      const response = await apiFetch('/api/support/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageId ? { messageId } : {})
      });
      if (!response.ok) throw new Error('Could not create a support ticket.');
      const result = (await response.json()) as { ticket?: SupportTicket };
      if (!result.ticket || typeof result.ticket.id !== 'string') {
        throw new Error('No valid support ticket was returned.');
      }
      return { ticket: result.ticket };
    },
    async older(uid, before) {
      return [];
    }
  };
}
