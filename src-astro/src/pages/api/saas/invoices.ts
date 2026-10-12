// GET /api/saas/invoices — facturas del socio. Solo con el modulo cloud; sin el, 404 "cloud disabled".
import { cloudRoute } from '../../../cloud';

export const GET = cloudRoute('saas.invoices', 'GET');
