import { SetMetadata } from '@nestjs/common';

/**
 * Roles disponibles en el sistema.
 *
 * admin    → acceso total al tenant (crear keys, ver todo, hacer refunds)
 * operator → puede crear pagos y ver reportes, no puede tocar config
 * viewer   → solo lectura (ver pagos, exportar)
 */
export type UserRole = 'admin' | 'operator' | 'viewer';

export const ROLES_KEY = 'roles';

/**
 * Decora un endpoint con los roles permitidos.
 * Ejemplo: @Roles('admin', 'operator')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
