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

const NUMBER_TOKEN = "[-+\\u2212]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)(?:[eE][-+\\u2212]?\\d+)?";
const NUMBER_REGEX = new RegExp(`^${NUMBER_TOKEN}$`);

export function rulesRecommendations(prompt: string): string {
  const lines = prompt.split('\n');
  const restockItems: { name: string; stock: string }[] = [];
  const topItems: { name: string; qty: string }[] = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('Stock bajo:')) {
      const parts = line.replace('Stock bajo:', '').trim();
      if (parts !== 'ninguno') {
        const regex = /\(([^()]*)\)\s*(?:,\s*|$)/g;
        let match;
        let lastMatchEnd = 0;
        while ((match = regex.exec(parts)) !== null) {
          let nameChunk = parts.slice(lastMatchEnd, match.index).trim();
          if (nameChunk.startsWith(',')) nameChunk = nameChunk.slice(1).trim();
          lastMatchEnd = regex.lastIndex;

          const inner = match[1];
          if (NUMBER_REGEX.test(inner)) {
            restockItems.push({ name: nameChunk, stock: inner });
          } else {
            restockItems.push({ name: `${nameChunk} (${inner})`, stock: "" });
          }
        }
      }
    }
    if (line.startsWith('Top ventas:')) {
      const parts = line.replace('Top ventas:', '').trim();
      if (parts !== 'sin datos') {
        const regex = new RegExp(`(.*?)\\s*x(${NUMBER_TOKEN})(?:,\\s*|$)`, 'g');
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
    let detail;
    if (item.stock === "") {
      detail = 'Está en la lista de stock bajo.';
    } else {
      const formattedStock = item.stock.replace(/\u2212/g, '-');
      detail = `El stock actual es de ${formattedStock}.`;
    }
    recommendations.push({
      type: 'restock',
      title: `Reponer ${item.name}`,
      detail,
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

export async function localInfer(prompt: string, env: LocalAiEnvironment = localAiEnvironment()): Promise<string> {
  const tier = await detectLocalAiTier(env);
  if (tier === 'prompt-api' && env.languageModel) {
    let session;
    try {
      const lines = prompt.split('\n');
      const systemPrompt = lines.find((l) => l.startsWith('Devuelve JSON:')) || 'Devuelve JSON: array de {type: restock|promo|menu|ops, title, detail} (máx 5, español).';
      session = await env.languageModel.create({ systemPrompt });
      const response = await session.prompt(prompt);
      if (response) {
        return response;
      }
    } catch {
      // fallback to rules on rejection
    } finally {
      if (session && session.destroy) {
        session.destroy();
      }
    }
  }
  return rulesRecommendations(prompt);
}
