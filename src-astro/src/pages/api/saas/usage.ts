// GET /api/saas/usage — consumo del periodo. Solo con el modulo cloud; sin el, 404 "cloud disabled".
import { cloudRoute } from '../../../cloud';

export const GET = cloudRoute('saas.usage', 'GET');
