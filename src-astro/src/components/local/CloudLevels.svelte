<script lang="ts">
  // CloudLevels.svelte — "Después, si quieres" (NODO-LOCAL.md §3 y §4 paso 6).
  // Cada nivel dice en una linea que ve SWAL. Lo que aun no existe dice "Próximamente", sin botones muertos.
  interface Level {
    title: string;
    what: string;
    sees: string;
    status: 'ya' | 'pronto';
    href?: string;
    cta?: string;
  }

  const LEVELS: Level[] = [
    {
      title: 'Copia en archivo',
      what: 'Descargas tu copia cifrada (.fize) y la guardas donde quieras: una memoria USB, tu correo, otro equipo.',
      sees: 'Qué ve SWAL: nada. El archivo no pasa por nuestros servidores.',
      status: 'ya',
      href: '/local/respaldo/',
      cta: 'Hacer una copia',
    },
    {
      title: 'Sumar otro equipo (QR)',
      what: 'La tableta de cocina o el celular de caja trabajan con los mismos datos que este equipo.',
      sees: 'Qué ve SWAL: solo ayuda a que los equipos se encuentren; los datos van cifrados de un equipo al otro.',
      status: 'pronto',
    },
    {
      title: 'Copia en la nube (cifrada)',
      what: 'Tu copia cifrada se guarda sola en la nube de SWAL y la recuperas en un equipo nuevo con tu código.',
      sees: 'Qué ve SWAL: el tamaño y la fecha de la copia. No puede abrirla sin tu código.',
      status: 'pronto',
    },
    {
      title: 'Nube completa con cuentas',
      what: 'Tu local en un servidor de SWAL, con cuentas para tu equipo y pedidos de mesa en vivo.',
      sees: 'Qué ve SWAL: tus datos se guardan cifrados, pero el servidor puede leerlos para que la nube funcione.',
      status: 'pronto',
    },
  ];
</script>

<ul class="levels">
  {#each LEVELS as level (level.title)}
    <li class="l-card level">
      <div class="level-head">
        <h3>{level.title}</h3>
        {#if level.status === 'pronto'}<span class="l-badge">Próximamente</span>{:else}<span class="l-badge ya">Disponible</span>{/if}
      </div>
      <p>{level.what}</p>
      <p class="sees">{level.sees}</p>
      {#if level.status === 'ya' && level.href}
        <a class="l-btn" href={level.href}>{level.cta}</a>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .levels { list-style: none; display: flex; flex-direction: column; gap: 0.75rem; }
  .level { gap: 0.5rem; }
  .level-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .level-head h3 { font-size: 1rem; font-weight: 650; color: var(--swal-text); }
  .sees { font-size: 0.875rem !important; color: var(--swal-text) !important; }
  .ya { color: var(--swal-text); border-color: var(--swal-success); }
  .level .l-btn { align-self: flex-start; }
</style>
