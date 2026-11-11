import { roleHas, type Permission, type Role } from "@furni/shared";

export interface AuthContext {
  userId: number;
  email: string;
  displayName: string;
  roles: Role[];
  /** Business customer this login acts as (customer role), if any. */
  customerId: number | null;
  /** Suppliers this login represents (supplier role). */
  supplierIds: number[];
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") { super(message); this.name = "ForbiddenError"; }
}

export function requirePermission(ctx: AuthContext | null, permission: Permission): asserts ctx is AuthContext {
  if (!ctx) throw new ForbiddenError("Authentication required");
  if (!roleHas(ctx.roles, permission)) throw new ForbiddenError(`Missing permission ${permission}`);
}

/**
 * Data-scope check: `:any:` permissions see everything; otherwise the caller
 * may only touch the customer it is mapped to.
 */
export function assertCustomerScope(ctx: AuthContext | null, customerId: number, anyPermission: Permission, ownPermission: Permission): asserts ctx is AuthContext {
  if (!ctx) throw new ForbiddenError("Authentication required");
  if (roleHas(ctx.roles, anyPermission)) return;
  if (roleHas(ctx.roles, ownPermission) && ctx.customerId === customerId) return;
  throw new ForbiddenError("Not your record");
}

export function assertSupplierScope(ctx: AuthContext | null, supplierId: number): asserts ctx is AuthContext {
  if (!ctx) throw new ForbiddenError("Authentication required");
  if (roleHas(ctx.roles, "supplier:manage")) return;
  if (roleHas(ctx.roles, "supplier:own:read") && ctx.supplierIds.includes(supplierId)) return;
  throw new ForbiddenError("Not your supplier record");
}
