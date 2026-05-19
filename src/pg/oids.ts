export type TsTypeInfo = {
  ts: string;
  bigint?: boolean;
};

const SCALAR: Record<number, TsTypeInfo> = {
  16: { ts: "boolean" },
  17: { ts: "Uint8Array" },
  18: { ts: "string" },
  20: { ts: "bigint", bigint: true },
  21: { ts: "number" },
  23: { ts: "number" },
  25: { ts: "string" },
  26: { ts: "number" },
  114: { ts: "unknown" },
  142: { ts: "string" },
  650: { ts: "string" },
  700: { ts: "number" },
  701: { ts: "number" },
  774: { ts: "string" },
  790: { ts: "string" },
  829: { ts: "string" },
  869: { ts: "string" },
  1042: { ts: "string" },
  1043: { ts: "string" },
  1082: { ts: "Date" },
  1083: { ts: "string" },
  1114: { ts: "Date" },
  1184: { ts: "Date" },
  1186: { ts: "string" },
  1266: { ts: "string" },
  1700: { ts: "string" },
  2950: { ts: "string" },
  3802: { ts: "unknown" },
  3614: { ts: "string" },
  3615: { ts: "string" },
};

const ARRAY: Record<number, number> = {
  1000: 16,
  1001: 17,
  1002: 18,
  1005: 21,
  1007: 23,
  1009: 25,
  1014: 1042,
  1015: 1043,
  1016: 20,
  1021: 700,
  1022: 701,
  1028: 26,
  1115: 1114,
  1182: 1082,
  1183: 1083,
  1185: 1184,
  1187: 1186,
  1231: 1700,
  1270: 1266,
  2951: 2950,
  3807: 3802,
  3643: 3614,
  3644: 3615,
};

export function oidToTs(oid: number): TsTypeInfo {
  const direct = SCALAR[oid];
  if (direct) return direct;
  const inner = ARRAY[oid];
  if (inner !== undefined) {
    const t = SCALAR[inner];
    return { ts: `(${t?.ts ?? "unknown"})[]`, bigint: t?.bigint };
  }
  return { ts: "unknown" };
}

export function isBuiltinOid(oid: number): boolean {
  return SCALAR[oid] !== undefined || ARRAY[oid] !== undefined;
}

export type ResolveTs = (oid: number) => string;

export function makeResolver(custom: (oid: number) => string | undefined): ResolveTs {
  return (oid: number) => {
    const c = custom(oid);
    if (c !== undefined) return c;
    return oidToTs(oid).ts;
  };
}
