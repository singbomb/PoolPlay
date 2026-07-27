import postgres from "postgres";
import { Table, getTableColumns, getTableName } from "drizzle-orm";
import * as schemaModule from "../../src/lib/db/schema";

type DatabaseColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
};

type ExpectedColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
  udtName?: string;
  nullable: boolean;
  hasDefault: boolean;
};

type EnumRow = {
  enum_name: string;
  enum_value: string;
  sort_order: number;
};

const databaseUrl = process.env.POOLPLAY_BOOTSTRAP_DATABASE_URL;

if (!databaseUrl?.startsWith("postgresql://postgres@127.0.0.1:")) {
  throw new Error(
    "POOLPLAY_BOOTSTRAP_DATABASE_URL must target the disposable local database"
  );
}

const loadedSchema =
  "default" in schemaModule &&
  schemaModule.default &&
  typeof schemaModule.default === "object"
    ? schemaModule.default
    : schemaModule;

const schemaValues = Object.values(loadedSchema);
const tableNameSymbol = (
  Table as unknown as { Symbol: { Name: symbol } }
).Symbol.Name;
const tables = schemaValues.filter(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    tableNameSymbol in value
) as Table[];
const enums = schemaValues.filter(
  (
    value
  ): value is {
    enumName: string;
    enumValues: string[];
  } =>
    typeof value === "function" &&
    "enumName" in value &&
    "enumValues" in value &&
    Array.isArray(value.enumValues)
);

function expectedDataType(column: {
  columnType: string;
  withTimezone?: boolean;
  enumName?: string;
}): Pick<ExpectedColumn, "dataType" | "udtName"> {
  switch (column.columnType) {
    case "PgBoolean":
      return { dataType: "boolean" };
    case "PgDateString":
      return { dataType: "date" };
    case "PgEnumColumn":
      return { dataType: "USER-DEFINED", udtName: column.enumName };
    case "PgInteger":
      return { dataType: "integer" };
    case "PgJsonb":
      return { dataType: "jsonb" };
    case "PgText":
      return { dataType: "text" };
    case "PgTimestamp":
      return {
        dataType: column.withTimezone
          ? "timestamp with time zone"
          : "timestamp without time zone",
      };
    case "PgUUID":
      return { dataType: "uuid" };
    default:
      throw new Error(`Unsupported Drizzle column type: ${column.columnType}`);
  }
}

const expectedColumns = tables.flatMap((table) => {
  const tableName = getTableName(table);

  return Object.values(getTableColumns(table)).map((column) => ({
    tableName,
    columnName: column.name,
    nullable: !column.notNull,
    hasDefault: column.hasDefault,
    ...expectedDataType(
      column as {
        columnType: string;
        withTimezone?: boolean;
        enumName?: string;
      }
    ),
  }));
});
const operationalColumns: ExpectedColumn[] = [
  {
    tableName: "account_deletion_requests",
    columnName: "id",
    dataType: "uuid",
    nullable: false,
    hasDefault: true,
  },
  {
    tableName: "account_deletion_requests",
    columnName: "auth_id",
    dataType: "text",
    nullable: false,
    hasDefault: false,
  },
  {
    tableName: "account_deletion_requests",
    columnName: "requested_at",
    dataType: "timestamp with time zone",
    nullable: false,
    hasDefault: true,
  },
  {
    tableName: "account_deletion_requests",
    columnName: "completed_at",
    dataType: "timestamp with time zone",
    nullable: true,
    hasDefault: false,
  },
  {
    tableName: "account_deletion_requests",
    columnName: "last_error",
    dataType: "text",
    nullable: true,
    hasDefault: false,
  },
  {
    tableName: "auth_rate_limits",
    columnName: "key_hash",
    dataType: "text",
    nullable: false,
    hasDefault: false,
  },
  {
    tableName: "auth_rate_limits",
    columnName: "scope",
    dataType: "text",
    nullable: false,
    hasDefault: false,
  },
  {
    tableName: "auth_rate_limits",
    columnName: "attempts",
    dataType: "integer",
    nullable: false,
    hasDefault: true,
  },
  {
    tableName: "auth_rate_limits",
    columnName: "window_expires_at",
    dataType: "timestamp with time zone",
    nullable: false,
    hasDefault: false,
  },
  {
    tableName: "auth_rate_limits",
    columnName: "updated_at",
    dataType: "timestamp with time zone",
    nullable: false,
    hasDefault: true,
  },
];
const allExpectedColumns = [...expectedColumns, ...operationalColumns];

const sql = postgres(databaseUrl, { max: 1 });
type DatabaseClient = typeof sql;

function compareColumn(
  expected: ExpectedColumn,
  actual: DatabaseColumn | undefined
): string[] {
  const key = `${expected.tableName}.${expected.columnName}`;
  if (!actual) {
    return [`Missing column ${key}`];
  }

  const errors: string[] = [];
  if (actual.data_type !== expected.dataType) {
    errors.push(
      `${key} type is ${actual.data_type}; expected ${expected.dataType}`
    );
  }

  if (expected.udtName && actual.udt_name !== expected.udtName) {
    errors.push(
      `${key} enum is ${actual.udt_name}; expected ${expected.udtName}`
    );
  }

  const actualNullable = actual.is_nullable === "YES";
  if (actualNullable !== expected.nullable) {
    errors.push(
      `${key} nullable is ${actualNullable}; expected ${expected.nullable}`
    );
  }

  const actualHasDefault = actual.column_default !== null;
  if (actualHasDefault !== expected.hasDefault) {
    errors.push(
      `${key} default presence is ${actualHasDefault}; expected ${
        expected.hasDefault
      }`
    );
  }

  return errors;
}

async function findColumnErrors(client: DatabaseClient): Promise<string[]> {
  const databaseColumns = await client<DatabaseColumn[]>`
    SELECT
      table_name,
      column_name,
      data_type,
      udt_name,
      is_nullable,
      column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const actualByKey = new Map(
    databaseColumns.map((column) => [
      `${column.table_name}.${column.column_name}`,
      column,
    ])
  );
  const expectedKeys = new Set(
    allExpectedColumns.map(
      (column) => `${column.tableName}.${column.columnName}`
    )
  );
  const errors: string[] = [];

  for (const expected of allExpectedColumns) {
    const key = `${expected.tableName}.${expected.columnName}`;
    errors.push(...compareColumn(expected, actualByKey.get(key)));
  }

  for (const column of databaseColumns) {
    const key = `${column.table_name}.${column.column_name}`;
    if (!expectedKeys.has(key)) {
      errors.push(`Database has an ORM-unmapped column ${key}`);
    }
  }

  return errors;
}

async function findEnumErrors(client: DatabaseClient): Promise<string[]> {
  const enumRows = await client<EnumRow[]>`
    SELECT
      type.typname AS enum_name,
      enum.enumlabel AS enum_value,
      enum.enumsortorder::integer AS sort_order
    FROM pg_type type
    JOIN pg_enum enum ON enum.enumtypid = type.oid
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
    ORDER BY type.typname, enum.enumsortorder
  `;
  const actualEnums = new Map<string, string[]>();
  const errors: string[] = [];

  for (const row of enumRows) {
    const values = actualEnums.get(row.enum_name) ?? [];
    values.push(row.enum_value);
    actualEnums.set(row.enum_name, values);
  }

  for (const expected of enums) {
    const actual = actualEnums.get(expected.enumName);
    if (!actual) {
      errors.push(`Missing enum ${expected.enumName}`);
      continue;
    }

    if (actual.join(",") !== expected.enumValues.join(",")) {
      errors.push(
        `${expected.enumName} values are ${actual.join(",")}; expected ${
          expected.enumValues.join(",")
        }`
      );
    }
  }

  const expectedEnumNames = new Set(enums.map((item) => item.enumName));
  for (const enumName of actualEnums.keys()) {
    if (!expectedEnumNames.has(enumName)) {
      errors.push(`Database has an ORM-unmapped enum ${enumName}`);
    }
  }

  return errors;
}

async function main() {
  const errors: string[] = [];

  try {
    errors.push(...(await findColumnErrors(sql)));
    errors.push(...(await findEnumErrors(sql)));
  } finally {
    await sql.end();
  }

  if (errors.length > 0) {
    throw new Error(`Database schema drift:\n- ${errors.join("\n- ")}`);
  }

  console.log(
    `Verified ${tables.length} ORM tables, two operational tables, and ${enums.length} enums against the rebuilt database.`
  );
}

void main();
