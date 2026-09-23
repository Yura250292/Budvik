-- READ ONLY role for the MCP connector (budvik_mcp_ro).
--
-- Виконується РУКАМИ по базі САЙТУ (PostgreSQL на Railway), не по 1С.
-- Роль нічого не пише: лише SELECT, і без доступу до секретів.
-- Скрипт ідемпотентний — запускати знову після кожної міграції, що додає
-- таблицю, яку читає вид query_db (нові таблиці навмисно НЕ стають
-- читабельними самі: ALTER DEFAULT PRIVILEGES тут немає).
--
--   psql "$DATABASE_URL_ADMIN" -v pwd="$(openssl rand -hex 24)" -f scripts/mcp/readonly-role.sql
--   (пароль потім — у MCP_READONLY_DATABASE_URL сервісу budvik-mcp)
--
-- Перевірка: scripts/check-mcp-readonly.mts.

\set ON_ERROR_STOP on

-- Усе однією транзакцією. Без неї psql комітить кожну команду окремо, і
-- падіння посередині (напр., таблиці зі схеми немає в базі) лишало б роль
-- уже з GRANT SELECT ON ALL TABLES, але ще без REVOKE секретів — тобто з
-- доступом до паролів. Тепер падіння = нічого не змінено.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budvik_mcp_ro') THEN
    CREATE ROLE budvik_mcp_ro;
  END IF;
END
$$;

ALTER ROLE budvik_mcp_ro WITH LOGIN PASSWORD :'pwd' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
-- Перший рубіж — сесія за замовчуванням лише на читання; справжній — права нижче
-- (default_transaction_read_only роль може зняти сама, а права — ні).
ALTER ROLE budvik_mcp_ro SET default_transaction_read_only = on;
ALTER ROLE budvik_mcp_ro SET statement_timeout = '20s';
ALTER ROLE budvik_mcp_ro SET idle_in_transaction_session_timeout = '30s';

SELECT current_database() AS db \gset
GRANT CONNECT ON DATABASE :"db" TO budvik_mcp_ro;
GRANT USAGE ON SCHEMA public TO budvik_mcp_ro;
-- До PostgreSQL 15 будь-хто міг створювати таблиці в public. Сайт ходить як
-- власник бази, тож йому це не заважає, а новій ролі — закриває DDL.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- З чистого аркуша, щоб повторний запуск не лишав старих грантів.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM budvik_mcp_ro;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM budvik_mcp_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO budvik_mcp_ro;

-- Таблиці, які цілком — секрет. Кожну — лише якщо вона є в цій базі: модель
-- у schema.prisma ще не означає таблицю (CalendarConnection з'явилась у схемі
-- раніше за свою міграцію), а _prisma_migrations немає в базі з db push.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'PasswordResetToken',  -- скидання пароля
    'DeviceToken',         -- токени робочої збірки й застосунку покупця
    'PushToken',           -- адреси пушів
    'CalendarConnection',  -- refresh-токени Google Calendar
    'McpClient',           -- секрети OAuth-клієнтів MCP
    'McpAuthCode',
    'McpToken',
    'RateLimit',
    '_prisma_migrations'   -- історія міграцій — моделі ні до чого
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE SELECT ON %I FROM budvik_mcp_ro', t);
    END IF;
  END LOOP;
END
$$;

-- Таблиці, де секрет — окрема колонка: знімаємо доступ до таблиці й даємо
-- всі колонки, крім секретних (список колонок береться з бази на момент запуску).
DO $$
DECLARE
  t text;
  cols text;
BEGIN
  FOR t, cols IN
    SELECT c.table_name, string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN ('User', 'Order', 'ClientOutreach')
      AND (c.table_name, c.column_name) NOT IN (
        ('User', 'password'),
        ('Order', 'guestToken'),
        ('ClientOutreach', 'linkToken')
      )
    GROUP BY c.table_name
  LOOP
    EXECUTE format('REVOKE SELECT ON %I FROM budvik_mcp_ro', t);
    EXECUTE format('GRANT SELECT (%s) ON %I TO budvik_mcp_ro', cols, t);
  END LOOP;
END
$$;

COMMIT;

\echo 'budvik_mcp_ro: done. Changed only this role and CREATE on schema public for PUBLIC; no data touched.'
