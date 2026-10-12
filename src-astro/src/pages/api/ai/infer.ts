// POST /api/ai/infer — inferencia con creditos de IA. Solo con el modulo cloud; sin el, 404
// "cloud disabled" y src/lib/llm.ts responde con su fallback local.
import { cloudRoute } from '../../../cloud';

export const POST = cloudRoute('ai.infer', 'POST');
export const GET = cloudRoute('ai.infer', 'GET');
