// Números del equipo (administradores, socios y domiciliario): no son clientes
export const soloDigitos = (s: string) => s.replace(/\D/g, '')
export const numerosEquipo = (cfg: Record<string, string | undefined>): string[] =>
  [...(cfg.admin_numeros ?? '').split(','), cfg.domiciliario_numero ?? ''].map(soloDigitos).filter(Boolean)
