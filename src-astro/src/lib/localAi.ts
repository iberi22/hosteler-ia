export type LocalAiTier = 'prompt-api' | 'rules';

export interface PromptApiLike {
  availability(): Promise<string>;
  create(options?: { systemPrompt?: string }): Promise<{ prompt(text: string): Promise<string>; destroy?(): void }>;
}

export interface LocalAiEnvironment {
  languageModel?: PromptApiLike;
}

export function localAiEnvironment(): LocalAiEnvironment {
  return { languageModel: (globalThis as any).LanguageModel };
}

export async function promptApiState(env: LocalAiEnvironment = localAiEnvironment()): Promise<string | undefined> {
  if (!env.languageModel) return undefined;
  try {
    return await env.languageModel.availability();
  } catch {
    return undefined;
  }
}

export async function detectLocalAiTier(env: LocalAiEnvironment = localAiEnvironment()): Promise<LocalAiTier> {
  const state = await promptApiState(env);
  if (state === 'available' || state === 'readily') {
    return 'prompt-api';
  }
  return 'rules';
}

export function rulesRecommendations(prompt: string): string {
  const lines = prompt.split('\n');
  const restockItems: { name: string; stock: string }[] = [];
  const topItems: { name: string; qty: string }[] = [];

  for (const line of lines) {
    if (line.startsWith('Stock bajo:')) {
      const parts = line.replace('Stock bajo:', '').trim();
      if (parts !== 'ninguno') {
        const regex = /(.*?)\s*\(([-+]?\d+(?:[.,]\d+)?)\)(?:,\s*|$)/g;
        let match;
        while ((match = regex.exec(parts)) !== null) {
          restockItems.push({ name: match[1].trim(), stock: match[2] });
        }
      }
    }
    if (line.startsWith('Top ventas:')) {
      const parts = line.replace('Top ventas:', '').trim();
      if (parts !== 'sin datos') {
        const regex = /(.*?)\s*x([-+]?\d+(?:[.,]\d+)?)(?:,\s*|$)/g;
        let match;
        while ((match = regex.exec(parts)) !== null) {
          topItems.push({ name: match[1].trim(), qty: match[2] });
        }
      }
    }
  }

  const recommendations: { type: string; title: string; detail: string }[] = [];

  // Up to 3 restock items
  for (const item of restockItems.slice(0, 3)) {
    recommendations.push({
      type: 'restock',
      title: `Reponer ${item.name}`,
      detail: `El stock actual es de ${item.stock}.`,
    });
  }

  // 1 promo for top item
  if (topItems.length > 0) {
    const top = topItems[0];
    recommendations.push({
      type: 'promo',
      title: `Promocionar ${top.name}`,
      detail: `Es un producto estrella con ${top.qty} ventas recientes.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      type: 'ops',
      title: 'Todo en orden',
      detail: 'El restaurante funciona correctamente.',
    });
  }

  return JSON.stringify(recommendations.slice(0, 5));
}

export interface LocalInferResult {
  text: string;
  tier: LocalAiTier;
}

export async function localInferWithTier(prompt: string, env: LocalAiEnvironment = localAiEnvironment()): Promise<LocalInferResult> {
  const tier = await detectLocalAiTier(env);
  if (tier === 'prompt-api' && env.languageModel) {
    let session;
    try {
      const lines = prompt.split('\n');
      const systemPrompt = lines.find((l) => l.startsWith('Devuelve JSON:')) || 'Devuelve JSON: array de {type: restock|promo|menu|ops, title, detail} (máx 5, español).';
      session = await env.languageModel.create({ systemPrompt });
      const response = await session.prompt(prompt);
      if (response) {
        return { text: response, tier: 'prompt-api' };
      }
    } catch {
      // fallback to rules on rejection
    } finally {
      if (session && session.destroy) {
        session.destroy();
      }
    }
  }
  return { text: rulesRecommendations(prompt), tier: 'rules' };
}

export async function localInfer(prompt: string, env: LocalAiEnvironment = localAiEnvironment()): Promise<string> {
  const result = await localInferWithTier(prompt, env);
  return result.text;
}
