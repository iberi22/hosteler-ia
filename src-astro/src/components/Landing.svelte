<script lang="ts">
  import { Button, Badge, Icon } from '@swal/ui';
  import { CONTACT_URL, CONTACT_EMAIL, DEMO_URL, START_URL } from '../lib/contact';

  interface Feature {
    title: string;
    description: string;
    /** Nombre del registro de iconos del core (@swal/ui/icons). */
    icon: string;
  }

  interface Faq {
    q: string;
    a: string;
  }

  const features: Feature[] = [
    {
      title: 'Carta con QR y WhatsApp',
      description:
        'Tus clientes ven la carta en el celular y piden desde la mesa o por WhatsApp. Cambias un precio y se actualiza al instante.',
      icon: 'qr',
    },
    {
      title: 'Pedidos a cocina',
      description:
        'Cada pedido llega a la pantalla de cocina con su mesa y su estado. Nada de comandas perdidas.',
      icon: 'chef',
    },
    {
      title: 'Recetas y nutrición',
      description:
        'Une cada plato con sus insumos y sabe cuánto te cuesta la porción y cuánto ganas, con información nutricional de GOS.',
      icon: 'book',
    },
    {
      title: 'Inventario que se descuenta solo',
      description:
        'Cada plato vendido descuenta sus ingredientes. Fize te avisa antes de que algo se acabe.',
      icon: 'package',
    },
    {
      title: 'Compras y proveedores',
      description:
        'Registra facturas y proveedores; el inventario y el costo se actualizan con cada compra.',
      icon: 'receipt',
    },
    {
      title: 'Analítica de ventas',
      description:
        'Mira qué se vende, a qué hora y qué plato deja más margen, sin hojas de cálculo.',
      icon: 'chart',
    },
  ];

  const steps = [
    {
      title: 'Abre Fize y crea tu local.',
      text: 'Sin cuenta: nombre, WhatsApp y enlace de tu carta. Todo se guarda en tu equipo.',
    },
    {
      title: 'Arma tu carta.',
      text: 'Categorías, platos y precios en minutos. Guarda tu código de recuperación y tu copia.',
    },
    {
      title: 'Publica, imprime tus QR y comparte tu enlace.',
      text: 'Con el código de activación de SWAL tu carta queda en línea y tus clientes piden por WhatsApp.',
    },
  ];

  const privacy = [
    ['No vendemos ni usamos tus datos.', 'No los compartimos con nadie ni los usamos para publicidad.'],
    ['Cifrado.', 'Tus datos se guardan cifrados desde el primer registro.'],
    ['Sin rastreo.', 'Ni en tu panel ni en tu carta hay píxeles ni analítica de terceros.'],
    ['Tú decides qué es público.', 'Solo se publica lo que marcas: carta, precios, horario, ubicación.'],
  ];

  const faqs: Faq[] = [
    {
      q: '¿De verdad es gratis? ¿Cuál es la trampa?',
      a: 'No hay trampa. Lo básico para trabajar es gratis para siempre. Si algún día ofrecemos algo de pago será opcional y por algo que nos cueste dinero, como respaldo gestionado o inteligencia artificial.',
    },
    {
      q: '¿Qué hacen con mis datos?',
      a: 'Nada. No los vendemos, no los usamos para publicidad y no los compartimos. Se guardan cifrados.',
    },
    {
      q: '¿Ustedes pueden ver mis recetas o mis ventas?',
      a: 'Hoy SWAL custodia las llaves de cifrado para que Fize funcione en la nube. Estamos moviendo las llaves a tus dispositivos; cuando terminemos, ni SWAL podrá leer tus recetas, costos ni ventas.',
    },
    {
      q: '¿Qué ve el público?',
      a: 'Solo lo que tú publicas: carta, precios, horario, ubicación y botón de WhatsApp. Recetas, costos, inventario y ventas nunca son públicos.',
    },
    {
      q: '¿Necesito comprar equipos?',
      a: 'No. Funciona en el celular, una tableta o un computador que ya tengas. Para la cocina sirve cualquier tableta.',
    },
    {
      q: '¿Y si se cae el internet?',
      a: 'Fize sigue funcionando en tus equipos y sincroniza cuando vuelve la conexión.',
    },
    {
      q: '¿Cómo me pagan los clientes?',
      a: 'Como ya lo haces: efectivo, datafono, Bre-B o transferencia. Fize registra el cobro; no maneja tu dinero ni cobra comisiones.',
    },
    {
      q: '¿Fize hace facturación electrónica?',
      a: 'Todavía no. Sigue usando tu proveedor de facturación; estamos evaluando integrarnos.',
    },
  ];
</script>

<div class="landing">
  <header class="topbar">
    <a class="logo" href="/" aria-label="Fize, inicio">Fize</a>
    <nav class="topnav" aria-label="Secciones">
      <a href="#como-funciona">Cómo funciona</a>
      <a href="#privacidad">Privacidad</a>
      <a href="#precio">Precio</a>
      <a href="#preguntas">Preguntas</a>
    </nav>
    <Button href="/login" variant="secondary" size="sm">Entrar</Button>
  </header>

  <main id="contenido" class="main">
    <!-- Una idea: que es Fize y la promesa. -->
    <section class="hero" aria-labelledby="hero-title">
      <Badge variant="neutral" size="md" dot>Gratis para restaurantes · Hecho en Colombia</Badge>
      <h1 id="hero-title" class="hero-title">Orden en tu cocina. Gratis. Tus datos son tuyos.</h1>
      <p class="hero-subtitle">
        Carta digital con QR, pedidos directo a cocina, recetas con costo por porción e inventario que se
        descuenta solo con cada venta. Para restaurantes, corrientazos, cafeterías y panaderías.
      </p>
      <div class="ctas">
        <Button href={START_URL} variant="primary" size="lg">Empezar gratis, sin registrarme</Button>
        <Button href={DEMO_URL} variant="secondary" size="lg">Ver la carta demo</Button>
      </div>
      <p class="fineprint">Sin cuenta · Sin tarjeta · Sin publicidad · Tus datos se quedan en tu equipo</p>
    </section>

    <section class="block" aria-labelledby="features-title">
      <header class="section-header">
        <h2 id="features-title" class="section-title">Todo lo de tu negocio en un solo lugar</h2>
      </header>
      <ul class="grid">
        {#each features as f (f.title)}
          <li class="card">
            <span class="card-icon"><Icon name={f.icon} size={22} /></span>
            <h3 class="card-title">{f.title}</h3>
            <p class="card-text">{f.description}</p>
          </li>
        {/each}
      </ul>
    </section>

    <section id="como-funciona" class="block" aria-labelledby="steps-title">
      <header class="section-header">
        <h2 id="steps-title" class="section-title">Empiezas en menos de 10 minutos</h2>
      </header>
      <ol class="steps">
        {#each steps as s}
          <li class="step">
            <h3 class="card-title">{s.title}</h3>
            <p class="card-text">{s.text}</p>
          </li>
        {/each}
      </ol>
      <div class="center">
        <Button href={START_URL} variant="primary" size="lg">Empezar gratis, sin registrarme</Button>
      </div>
    </section>

    <section id="demo" class="block panel" aria-labelledby="demo-title">
      <header class="section-header">
        <h2 id="demo-title" class="section-title">Mira una carta real</h2>
        <p class="section-subtitle">
          Así ve tu cliente la carta en su celular: categorías, precios, información de alérgenos y botón para pedir.
        </p>
      </header>
      <div class="center">
        <Button href={DEMO_URL} variant="secondary" size="lg">Ver carta de ejemplo</Button>
      </div>
    </section>

    <section class="block panel" aria-labelledby="diners-title">
      <header class="section-header">
        <Badge variant="info" size="md">Próximamente</Badge>
        <h2 id="diners-title" class="section-title">Menús cerca de mí</h2>
        <p class="section-subtitle">
          Muy pronto podrás encontrar cartas reales cerca de ti, filtrar por tipo de comida, precio o dieta y ocultar los
          platos con alérgenos que no puedes comer. Sin descargar nada y sin crear cuenta.
        </p>
      </header>
    </section>

    <section id="privacidad" class="block" aria-labelledby="privacy-title">
      <header class="section-header">
        <h2 id="privacy-title" class="section-title">Tus recetas y tus números son tuyos</h2>
      </header>
      <ul class="privacy">
        {#each privacy as [head, text] (head)}
          <li class="privacy-item">
            <span class="privacy-check"><Icon name="check" size={18} /></span>
            <p class="card-text"><strong>{head}</strong> {text}</p>
          </li>
        {/each}
      </ul>
      <p class="note">
        Somos transparentes: hoy SWAL custodia las llaves de cifrado para que Fize funcione en la nube. Estamos moviendo
        esas llaves a tus dispositivos; cuando terminemos, ni SWAL podrá leer tus recetas, costos ni ventas.
      </p>
    </section>

    <section id="precio" class="block panel" aria-labelledby="price-title">
      <header class="section-header">
        <h2 id="price-title" class="section-title">Gratis. De verdad.</h2>
        <p class="section-subtitle">
          Carta, QR, pedidos, cocina, recetas, inventario y compras: gratis, sin límite de tiempo y sin tarjeta.
        </p>
      </header>
      <p class="note">
        <strong>¿Cómo se sostiene?</strong> Fize es parte de la red SWAL. Más adelante habrá servicios opcionales que sí nos
        cuestan dinero (por ejemplo respaldo gestionado o asistencia con inteligencia artificial). Lo que necesitas para
        trabajar cada día seguirá siendo gratis, y nunca vamos a vender tus datos para cubrir costos.
      </p>
    </section>

    <section id="preguntas" class="block" aria-labelledby="faq-title">
      <header class="section-header">
        <h2 id="faq-title" class="section-title">Preguntas frecuentes</h2>
      </header>
      <div class="faq">
        {#each faqs as f (f.q)}
          <details class="faq-item">
            <summary>{f.q}</summary>
            <p class="card-text">{f.a}</p>
          </details>
        {/each}
      </div>
    </section>

    <section class="block closing" aria-labelledby="closing-title">
      <h2 id="closing-title" class="section-title">Pon orden en tu cocina hoy</h2>
      <p class="section-subtitle">Gratis, sin tarjeta y en menos de 10 minutos.</p>
      <div class="ctas">
        <Button href={START_URL} variant="primary" size="lg">Empezar gratis, sin registrarme</Button>
      </div>
      <p class="fineprint">¿Dudas? Escríbenos a <a href={CONTACT_URL}>{CONTACT_EMAIL}</a> · ¿Ya tienes cuenta en la nube? <a href="/login">Entrar</a></p>
    </section>
  </main>

  <footer class="footer">
    <p>Fize es parte de SWAL · <a href={CONTACT_URL}>{CONTACT_EMAIL}</a></p>
    <p>Información nutricional: GOS</p>
  </footer>
</div>

<style>
  .landing {
    display: flex;
    flex-direction: column;
    gap: clamp(2rem, 5vw, 3.5rem);
    width: 100%;
    max-width: 1100px;
    margin: 0 auto;
    padding: 1rem 1rem 3rem;
    color: var(--swal-text);
    font-family: var(--swal-font);
  }

  a {
    color: var(--swal-text);
    text-underline-offset: 3px;
  }

  /* ─── Barra superior ─── */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .logo {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    text-decoration: none;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
  }
  .topnav {
    display: none;
    gap: 1.25rem;
    margin-inline: auto;
  }
  .topnav a {
    color: var(--swal-text-secondary);
    text-decoration: none;
    font-size: 0.9375rem;
    padding: 0.75rem 0;
  }
  .topnav a:hover { color: var(--swal-text); }
  @media (min-width: 760px) {
    .topnav { display: flex; }
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: clamp(3rem, 6vw, 5rem);
  }

  /* ─── Hero ─── */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 1.25rem;
    padding-top: clamp(1rem, 4vw, 3rem);
  }
  .hero-title {
    font-size: clamp(2rem, 1.2rem + 4vw, 3.75rem);
    font-weight: 700;
    line-height: 1.08;
    letter-spacing: -0.035em;
    max-width: 20ch;
    text-wrap: balance;
  }
  .hero-subtitle {
    font-size: clamp(1rem, 0.95rem + 0.3vw, 1.1875rem);
    line-height: 1.6;
    color: var(--swal-text-secondary);
    max-width: 58ch;
    text-wrap: pretty;
  }
  .ctas {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .fineprint {
    font-size: 0.875rem;
    color: var(--swal-text-secondary);
  }
  .center {
    display: flex;
    justify-content: center;
  }

  /* ─── Bloques ─── */
  .block {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    scroll-margin-top: 1rem;
  }
  .section-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    text-align: center;
  }
  .section-title {
    font-size: clamp(1.5rem, 1.1rem + 1.4vw, 2.125rem);
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-wrap: balance;
  }
  .section-subtitle {
    font-size: 1.0625rem;
    line-height: 1.6;
    color: var(--swal-text-secondary);
    max-width: 62ch;
    text-wrap: pretty;
  }
  .panel {
    align-items: center;
    padding: clamp(1.5rem, 4vw, 2.5rem) 1.25rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
    box-shadow: var(--swal-shadow-sm);
  }

  .grid {
    list-style: none;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 640px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (min-width: 1000px) {
    .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 1.5rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
    box-shadow: var(--swal-shadow-sm);
  }
  .card-icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--swal-radius);
    background: var(--swal-accent-muted);
    color: var(--swal-text);
  }
  .card-title {
    font-size: 1.0625rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .card-text {
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--swal-text-secondary);
  }
  .card-text strong { color: var(--swal-text); }

  /* ─── Pasos ─── */
  .steps {
    list-style: none;
    counter-reset: paso;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  @media (min-width: 760px) {
    .steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .step {
    counter-increment: paso;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.5rem;
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius-lg);
  }
  .step::before {
    content: counter(paso);
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    background: var(--swal-accent);
    color: var(--swal-on-accent);
    font-weight: 700;
  }

  /* ─── Privacidad ─── */
  .privacy {
    list-style: none;
    display: grid;
    gap: 0.875rem;
    max-width: 720px;
    margin-inline: auto;
    width: 100%;
  }
  .privacy-item {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .privacy-check {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: var(--swal-accent-muted);
    color: var(--swal-text);
  }
  .note {
    max-width: 720px;
    margin-inline: auto;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--swal-text-secondary);
  }
  .note strong { color: var(--swal-text); }

  /* ─── FAQ ─── */
  .faq {
    display: grid;
    gap: 0.5rem;
    max-width: 760px;
    width: 100%;
    margin-inline: auto;
  }
  .faq-item {
    background: var(--swal-surface);
    border: 1px solid var(--swal-border);
    border-radius: var(--swal-radius);
    padding: 0 1rem;
  }
  .faq-item summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
    font-weight: 600;
    padding: 0.5rem 0;
  }
  .faq-item p { padding-bottom: 1rem; }

  /* ─── Cierre y pie ─── */
  .closing {
    align-items: center;
    text-align: center;
  }
  .footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--swal-border);
    font-size: 0.875rem;
    color: var(--swal-text-secondary);
    text-align: center;
  }
  .footer a, .fineprint a { color: var(--swal-text); }

  /* Movil: los CTA ocupan todo el ancho y se apilan; el primario arriba. */
  @media (max-width: 520px) {
    .ctas { flex-direction: column; align-self: stretch; }
    .ctas :global(.swal-btn) { width: 100%; }
  }
</style>
