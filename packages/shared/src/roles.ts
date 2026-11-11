/** Role and permission model. Enforced server-side in @furni/database (authorize.ts). */
export const ROLES = ["customer", "administrator", "warehouse", "supplier", "student"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "catalog:read",
  "cart:own",
  "order:own:read",
  "order:own:create",
  "feedback:own:write",
  "loyalty:own:read",
  "order:any:read",
  "order:any:transition",
  "order:confirm",
  "order:fulfil",
  "product:manage",
  "offer:manage",
  "customer:read",
  "supplier:manage",
  "inventory:read",
  "inventory:receive",
  "reorder:manage",
  "settlement:manage",
  "loyalty:manage",
  "settlement:own:read",
  "supplier:own:read",
  "report:read",
  "lab:read",
  "lab:scenario:run",
  "lab:reset",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Role → permission matrix (documented in docs/database/ROLES.md). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  customer: [
    "catalog:read", "cart:own", "order:own:read", "order:own:create",
    "feedback:own:write", "loyalty:own:read",
  ],
  administrator: [
    "catalog:read", "order:any:read", "order:any:transition", "order:confirm", "order:fulfil",
    "product:manage", "offer:manage", "customer:read", "supplier:manage",
    "inventory:read", "inventory:receive", "reorder:manage", "settlement:manage",
    "loyalty:manage", "report:read", "lab:read", "lab:scenario:run", "lab:reset",
  ],
  warehouse: [
    "catalog:read", "order:any:read", "order:confirm", "order:fulfil", "inventory:read",
    "inventory:receive", "reorder:manage",
  ],
  supplier: ["catalog:read", "supplier:own:read", "settlement:own:read"],
  student: ["catalog:read", "lab:read", "lab:scenario:run", "lab:reset"],
};

export function roleHas(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(permission));
}
