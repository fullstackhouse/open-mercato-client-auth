import { Migration } from '@mikro-orm/migrations'

export class Migration20260704120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "better_auth_oauth_accounts" (
        "id" uuid not null default gen_random_uuid(),
        "user_id" uuid not null,
        "provider" text not null,
        "provider_user_id" text not null,
        "access_token_hash" text null,
        "refresh_token_hash" text null,
        "access_token_expires_at" timestamptz null,
        "scope" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "better_auth_oauth_accounts_pkey" primary key ("id")
      );`,
    )
    this.addSql(
      `alter table "better_auth_oauth_accounts" add constraint "better_auth_oauth_accounts_provider_subject_uq" unique ("provider", "provider_user_id");`,
    )
    this.addSql(
      `create index "better_auth_oauth_accounts_user_idx" on "better_auth_oauth_accounts" ("user_id");`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "better_auth_oauth_accounts" cascade;`)
  }
}
