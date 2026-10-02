/* One provider interface for the model that writes fix suggestions. You bring the model.
 *
 *   createProvider({ provider, model, apiKey, baseUrl }) -> { name, model, complete({ system, prompt }) }
 *
 *   openai              https://api.openai.com/v1, chat completions, key OPENAI_API_KEY
 *   anthropic           https://api.anthropic.com/v1/messages, key ANTHROPIC_API_KEY
 *   gemini              generativelanguage.googleapis.com generateContent, key GEMINI_API_KEY
 *   openai-compatible   any server that speaks chat completions at --base-url, including a local
 *                       model (Ollama, LM Studio, vLLM, llama.cpp). A key is optional.
 *   stub                no network. Returns a fixed template built from the prompt. For tests and
 *                       for seeing exactly what would be sent.
 *
 * There is no default model and no default provider. Nothing is called unless you name both.
 * SHIPPROBE_API_KEY overrides the provider's own variable, for a key held under another name.
 */

export const PROVIDERS = ['openai', 'anthropic', 'gemini', 'openai-compatible', 'stub'];

const KEY_VARS = {
  openai: ['SHIPPROBE_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['SHIPPROBE_API_KEY', 'ANTHROPIC_API_KEY'],
  gemini: ['SHIPPROBE_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'openai-compatible': ['SHIPPROBE_API_KEY'],
  stub: [],
};

export function keyFor(provider, env = process.env) {
  for (const v of KEY_VARS[provider] || []) if (env[v]) return env[v];
  return null;
}

async function post(url, headers, body, timeout = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* reported below */
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json?.error?.message || json?.error || text).toString().slice(0, 300)}`);
    if (!json) throw new Error('the response was not JSON');
    return json;
  } finally {
    clearTimeout(t);
  }
}

export function createProvider({ provider, model, apiKey, baseUrl } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`--provider must be one of ${PROVIDERS.join(', ')}`);
  if (!model && provider !== 'stub') throw new Error('--model is required. There is no default model.');
  if (provider === 'openai-compatible' && !baseUrl) throw new Error('--base-url is required for openai-compatible');
  if (['openai', 'anthropic', 'gemini'].includes(provider) && !apiKey) {
    throw new Error(`no API key for ${provider}. Set ${KEY_VARS[provider].join(' or ')}.`);
  }

  if (provider === 'stub') {
    return {
      name: 'stub',
      model: model || 'stub',
      async complete({ prompt }) {
        const ids = [...prompt.matchAll(/"id":\s*"([^"]+)"/g)].map((m) => m[1]);
        const uniq = [...new Set(ids)];
        return uniq.length
          ? uniq.map((id, i) => `${i + 1}. ${id}: the stub provider names the finding and writes no fix. Configure a real model to get one.`).join('\n')
          : 'The report has no failing finding, so there is nothing to fix.';
      },
    };
  }

  if (provider === 'openai' || provider === 'openai-compatible') {
    const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      name: provider,
      model,
      async complete({ system, prompt }) {
        const json = await post(`${base}/chat/completions`, apiKey ? { authorization: `Bearer ${apiKey}` } : {}, {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        });
        const text = json.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new Error('the response carried no message content');
        return text;
      },
    };
  }

  if (provider === 'anthropic') {
    const base = (baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    return {
      name: provider,
      model,
      async complete({ system, prompt, maxTokens = 4096 }) {
        const json = await post(`${base}/messages`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (!text) throw new Error('the response carried no text');
        return text;
      },
    };
  }

  /* gemini */
  const base = (baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  return {
    name: provider,
    model,
    async complete({ system, prompt, maxTokens = 4096 }) {
      const json = await post(`${base}/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': apiKey }, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error(`the response carried no text${json.candidates?.[0]?.finishReason ? ` (finish reason ${json.candidates[0].finishReason})` : ''}`);
      return text;
    },
  };
}
