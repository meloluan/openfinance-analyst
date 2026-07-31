/**
 * Migrations versionadas. O índice no array é a versão: `user_version` do SQLite
 * guarda quantas já foram aplicadas, então banco novo aplica tudo e banco
 * existente aplica só o que falta. Nunca edite uma migration já publicada —
 * acrescente outra ao final.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    institution_name TEXT NOT NULL,
    status TEXT NOT NULL,
    last_updated_at TEXT,
    consent_expires_at TEXT,
    last_synced_at TEXT
  );

  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    number TEXT,
    balance REAL NOT NULL,
    currency_code TEXT NOT NULL,
    credit_limit REAL,
    available_credit_limit REAL,
    close_date TEXT,
    due_date TEXT
  );

  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    currency_code TEXT NOT NULL,
    category TEXT,
    merchant_name TEXT,
    installment_number INTEGER,
    installment_total INTEGER,
    bill_forecast_date TEXT,
    status TEXT NOT NULL,
    raw TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );

  CREATE INDEX idx_tx_date ON transactions(date);
  CREATE INDEX idx_tx_account ON transactions(account_id);

  CREATE TABLE category_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE budgets (
    category TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
]
