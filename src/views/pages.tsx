import type { GuestItem, OwnerItem, SideGift } from "../domain/types.js";
import type { LocaleCode, Translate } from "../i18n/index.js";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DraftAddRow,
  ExternalLinkIcon,
  InlineDraftEdit,
  TurnstileWidget,
  formatHost,
  formatMoney,
  formatOccasionDate,
  turnstileScripts,
} from "./components.js";
import { Layout } from "./layout.js";
import type {
  DashboardList,
  DashboardPage,
  ForgotPage,
  GuestListPage,
  GuestLoginPage,
  InvitePage,
  LandingPage,
  LoginPage,
  OwnerPage,
  ResetPage,
  SignupPage,
} from "./props.js";

export { TurnstileWidget } from "./components.js";

function renderAlert(message: string) {
  return (
    <div class="flash flash-err" role="alert">
      {message}
    </div>
  );
}

function renderStatus(message: string) {
  return (
    <div class="flash flash-ok" role="status">
      {message}
    </div>
  );
}

function renderDaysLeft(daysLeft: number | null, t: Translate) {
  if (daysLeft === null) return null;
  let text: string;
  if (daysLeft > 1) text = t("owner.days_left_many", { days: daysLeft });
  else if (daysLeft === 1) text = t("owner.days_left_one");
  else if (daysLeft === 0) text = t("owner.days_left_zero");
  else text = t("owner.days_passed");

  return <span class="pill pill-sun tabular">{text}</span>;
}

function GoogleSignInBlock({ enabled, t }: { enabled: boolean; t: Translate }) {
  if (!enabled) return null;
  return (
    <div class="oauth-block">
      <a href="/auth/google" class="btn btn-secondary btn-block">
        {t("auth.google_continue")}
      </a>
      <div class="auth-divider" aria-hidden="true">
        <span>{t("common.or")}</span>
      </div>
    </div>
  );
}

export function LandingView(p: LandingPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("landing.page_title")}>
      <section class="hero-block">
        <h1>{t("landing.heading")}</h1>
        <p class="lead-copy">{t("landing.intro")}</p>
        <div class="action-cluster">
          <a href="/signup" class="btn btn-primary">
            {t("landing.signup_cta")}
          </a>
          <a href="/login" class="btn btn-secondary">
            {t("landing.login_cta")}
          </a>
        </div>
      </section>

      <section class="surface-card surface-card-accent" aria-labelledby="how-heading">
        <h2 id="how-heading">{t("landing.how_heading")}</h2>
        <ol class="steps-list">
          <li>{t("landing.step_one")}</li>
          <li>{t("landing.step_two")}</li>
          <li>{t("landing.step_three")}</li>
        </ol>
      </section>
    </Layout>
  );
}

function renderSignupError(error: SignupPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "weak-password":
      return renderAlert(t("error.weak_password"));
    case "email-taken":
      return renderAlert(t("error.email_taken"));
    case "captcha":
      return renderAlert(t("error.captcha"));
    case "rate-limited":
      return renderAlert(t("error.rate_limited"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function SignupView(p: SignupPage) {
  const { t } = p.chrome;
  return (
    <Layout
      chrome={p.chrome}
      title={t("signup.page_title")}
      scripts={turnstileScripts(p.captchaSiteKey)}
    >
      <section class="hero-block">
        <h1>{t("signup.heading")}</h1>
        <p class="lead-copy">{t("signup.intro")}</p>
      </section>

      {renderSignupError(p.error, t)}

      <div class="surface-card surface-card-accent">
        <GoogleSignInBlock enabled={p.googleEnabled} t={t} />

        <form method="post" action="/signup" class="stack-form">
          <div class="field-group">
            <label for="signup-name">{t("signup.name_label")}</label>
            <input
              id="signup-name"
              name="name"
              type="text"
              required
              maxlength={120}
              autocomplete="name"
              value={p.values.name}
              placeholder={t("signup.name_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="signup-email">{t("auth.email_label")}</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              value={p.values.email}
              placeholder={t("auth.email_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="signup-password">{t("auth.password_label")}</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              required
              minlength={10}
              maxlength={200}
              autocomplete="new-password"
              aria-describedby="signup-password-hint"
            />
            <p id="signup-password-hint" class="field-hint">
              {t("auth.password_hint")}
            </p>
          </div>

          <TurnstileWidget siteKey={p.captchaSiteKey} />

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-wide">
              {t("signup.submit")}
            </button>
          </div>
        </form>

        <p class="auth-links">
          <span>{t("signup.have_account")}</span>{" "}
          <a href="/login">{t("signup.login_link")}</a>
        </p>
      </div>
    </Layout>
  );
}

function renderLoginError(error: LoginPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "wrong-credentials":
      return renderAlert(t("error.wrong_credentials"));
    case "throttled":
      return renderAlert(t("error.throttled"));
    case "google-failed":
      return renderAlert(t("error.google_failed"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function LoginView(p: LoginPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("login.page_title")}>
      <section class="hero-block">
        <h1>{t("login.heading")}</h1>
        <p class="lead-copy">{t("login.intro")}</p>
      </section>

      {renderLoginError(p.error, t)}

      <div class="surface-card surface-card-accent">
        <GoogleSignInBlock enabled={p.googleEnabled} t={t} />

        <form method="post" action="/login" class="stack-form">
          <div class="field-group">
            <label for="login-email">{t("auth.email_label")}</label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              value={p.email}
              placeholder={t("auth.email_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="login-password">{t("auth.password_label")}</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              maxlength={200}
              autocomplete="current-password"
            />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-wide">
              {t("login.submit")}
            </button>
          </div>
        </form>

        <div class="auth-links">
          <a href="/forgot">{t("login.forgot_link")}</a>
          <span>
            {t("login.no_account")} <a href="/signup">{t("login.signup_link")}</a>
          </span>
        </div>
      </div>
    </Layout>
  );
}

function renderForgotError(error: ForgotPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "captcha":
      return renderAlert(t("error.captcha"));
    case "rate-limited":
      return renderAlert(t("error.rate_limited"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function ForgotView(p: ForgotPage) {
  const { t } = p.chrome;
  const activeSiteKey = p.sent ? null : p.captchaSiteKey;
  return (
    <Layout
      chrome={p.chrome}
      title={t("forgot.page_title")}
      scripts={turnstileScripts(activeSiteKey)}
    >
      <section class="hero-block">
        <h1>{t("forgot.heading")}</h1>
        <p class="lead-copy">{t("forgot.intro")}</p>
      </section>

      {renderForgotError(p.error, t)}

      {p.sent ? (
        <div class="surface-card surface-card-accent stack-form">
          <p role="status">{t("forgot.sent_notice")}</p>
          <div class="form-actions">
            <a href="/login" class="btn btn-secondary">
              {t("forgot.back_to_login")}
            </a>
          </div>
        </div>
      ) : (
        <div class="surface-card surface-card-accent">
          <form method="post" action="/forgot" class="stack-form">
            <div class="field-group">
              <label for="forgot-email">{t("auth.email_label")}</label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                required
                maxlength={254}
                autocomplete="email"
                placeholder={t("auth.email_placeholder")}
              />
            </div>

            <TurnstileWidget siteKey={p.captchaSiteKey} />

            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-wide">
                {t("forgot.submit")}
              </button>
            </div>
          </form>

          <p class="auth-links">
            <a href="/login">{t("forgot.back_to_login")}</a>
          </p>
        </div>
      )}
    </Layout>
  );
}

function renderResetError(error: ResetPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "weak-password":
      return renderAlert(t("error.weak_password"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function ResetView(p: ResetPage) {
  const { t } = p.chrome;
  switch (p.state) {
    case "expired":
      return (
        <Layout chrome={p.chrome} title={t("reset.page_title")}>
          <section class="hero-block">
            <h1>{t("reset.expired_heading")}</h1>
            <p class="lead-copy">{t("reset.expired_body")}</p>
          </section>
          <div class="action-cluster">
            <a href="/forgot" class="btn btn-primary">
              {t("reset.request_new")}
            </a>
            <a href="/login" class="btn btn-secondary">
              {t("forgot.back_to_login")}
            </a>
          </div>
        </Layout>
      );

    case "done":
      return (
        <Layout chrome={p.chrome} title={t("reset.page_title")}>
          <section class="hero-block">
            <h1>{t("reset.done_heading")}</h1>
            <p class="lead-copy">{t("reset.done_body")}</p>
          </section>
          <div class="action-cluster">
            <a href="/dashboard" class="btn btn-primary">
              {t("reset.open_dashboard")}
            </a>
          </div>
        </Layout>
      );

    case "form":
      return (
        <Layout chrome={p.chrome} title={t("reset.page_title")}>
          <section class="hero-block">
            <h1>{t("reset.heading")}</h1>
          </section>

          {renderResetError(p.error, t)}

          <div class="surface-card surface-card-accent">
            <form
              method="post"
              action={`/reset/${encodeURIComponent(p.token)}`}
              class="stack-form"
            >
              <div class="field-group">
                <label for="reset-password">{t("auth.new_password_label")}</label>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  required
                  minlength={10}
                  maxlength={200}
                  autocomplete="new-password"
                  aria-describedby="reset-password-hint"
                />
                <p id="reset-password-hint" class="field-hint">
                  {t("auth.password_hint")}
                </p>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary btn-wide">
                  {t("reset.submit")}
                </button>
              </div>
            </form>
          </div>
        </Layout>
      );

    default: {
      const _exhaustive: never = p.state;
      return _exhaustive;
    }
  }
}

function renderDashboardFlash(flash: DashboardPage["flash"], t: Translate) {
  if (!flash) return null;
  switch (flash) {
    case "created":
      return renderStatus(t("dashboard.flash_created"));
    case "deleted":
      return renderStatus(t("dashboard.flash_deleted"));
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "rate-limited":
      return renderAlert(t("error.rate_limited"));
    case "cap-reached":
      return renderAlert(t("dashboard.flash_cap_reached"));
    default: {
      const _exhaustive: never = flash;
      return _exhaustive;
    }
  }
}

function DashboardListRow({
  list,
  displayLocale,
  t,
}: {
  list: DashboardList;
  displayLocale: LocaleCode;
  t: Translate;
}) {
  const wishCount =
    list.itemCount === 1
      ? t("dashboard.item_count_one")
      : t("dashboard.item_count_many", { count: list.itemCount });

  return (
    <li class="dashboard-card">
      <a href={`/o/${list.id}`} class="dashboard-card-link">
        <span class="item-name">{list.title}</span>
        <span class="list-meta">
          {renderDaysLeft(list.daysLeft, t)}
          {list.occasionDate && (
            <span class="meta-text">{formatOccasionDate(list.occasionDate, displayLocale)}</span>
          )}
          <span class="pill pill-muted tabular">{wishCount}</span>
        </span>
      </a>
    </li>
  );
}

export function DashboardView(p: DashboardPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("dashboard.page_title")}>
      {renderDashboardFlash(p.flash, t)}

      <header class="list-head">
        <h1>{t("dashboard.heading")}</h1>
        <p class="meta-text">{t("dashboard.greeting", { name: p.userName })}</p>
      </header>

      <section class="page-section" aria-label={t("dashboard.heading")}>
        {p.lists.length === 0 ? (
          <p class="empty-state">{t("dashboard.empty_lists")}</p>
        ) : (
          <ul class="dashboard-list">
            {p.lists.map((list) => (
              <DashboardListRow
                key={list.id}
                list={list}
                displayLocale={p.chrome.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="page-section" aria-labelledby="new-list-heading">
        <h2 id="new-list-heading">{t("dashboard.new_list_heading")}</h2>
        <div class="surface-card surface-card-accent">
          <form method="post" action="/lists" class="stack-form">
            <div class="field-group">
              <label for="create-title">{t("dashboard.title_label")}</label>
              <input
                id="create-title"
                name="title"
                type="text"
                required
                maxlength={120}
                placeholder={t("dashboard.title_placeholder")}
              />
            </div>

            <div class="field-row">
              <div class="field-group">
                <label for="create-occasion-date">
                  <span>{t("dashboard.occasion_date_label")}</span>
                  <span class="field-optional">{t("common.optional")}</span>
                </label>
                <input id="create-occasion-date" name="occasionDate" type="date" />
              </div>

              <div class="field-group">
                <label for="create-locale">{t("dashboard.locale_label")}</label>
                <select id="create-locale" name="locale">
                  {p.chrome.locales.map((entry) => (
                    <option
                      key={entry.code}
                      value={entry.code}
                      selected={entry.code === p.chrome.locale}
                    >
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary btn-wide">
                {t("dashboard.create_submit")}
              </button>
            </div>
          </form>
        </div>
      </section>
    </Layout>
  );
}

function renderOwnerFlash(flash: OwnerPage["flash"], t: Translate) {
  if (!flash) return null;
  switch (flash) {
    case "invite-regenerated":
      return renderStatus(t("owner.flash_invite_regenerated"));
    case "locale-saved":
      return renderStatus(t("owner.flash_locale_saved"));
    case "invalid":
      return renderAlert(t("error.invalid"));
    default: {
      const _exhaustive: never = flash;
      return _exhaustive;
    }
  }
}

function OwnerChecklistRow({
  item,
  index,
  count,
  listId,
  listLocale,
  t,
}: {
  item: OwnerItem;
  index: number;
  count: number;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const itemBase = `/o/${listId}/items/${item.id}`;
  const checkLabel = item.received
    ? t("owner.unmark_received", { name: item.name })
    : t("owner.mark_received", { name: item.name });

  return (
    <li id={`item-${item.id}`} class={`checklist-row${item.received ? " is-received" : ""}`}>
      <div class="checklist-main">
        <form method="post" action={`${itemBase}/received`} class="check-form">
          <input type="hidden" name="received" value={item.received ? "0" : "1"} />
          <button
            type="submit"
            class={`round-check${item.received ? " is-checked" : ""}`}
            role="checkbox"
            aria-checked={item.received ? "true" : "false"}
            aria-label={checkLabel}
            title={checkLabel}
          >
            <span class="round-check-disc" aria-hidden="true">
              {item.received && <CheckIcon />}
            </span>
          </button>
        </form>

        <div class="item-body">
          <div class="item-title-line">
            <span class="item-name">{item.name}</span>
            {item.received && <span class="pill pill-mint">{t("owner.received_badge")}</span>}
            {item.priceCents !== null && (
              <span class="item-price tabular">{formatMoney(item.priceCents, listLocale)}</span>
            )}
          </div>

          {item.details && <p class="item-details">{item.details}</p>}

          {item.url && (
            <a
              href={item.url}
              class="item-link"
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`${t("common.open_link")}: ${item.name}`}
            >
              <span>{formatHost(item.url)}</span>
              <ExternalLinkIcon />
            </a>
          )}
        </div>

        <div class="row-controls">
          <form method="post" action={`${itemBase}/move`} class="inline-form">
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              class="icon-btn"
              disabled={index === 0}
              aria-label={t("owner.move_up", { name: item.name })}
              title={t("owner.move_up", { name: item.name })}
            >
              <ChevronUpIcon />
            </button>
          </form>

          <form method="post" action={`${itemBase}/move`} class="inline-form">
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              class="icon-btn"
              disabled={index === count - 1}
              aria-label={t("owner.move_down", { name: item.name })}
              title={t("owner.move_down", { name: item.name })}
            >
              <ChevronDownIcon />
            </button>
          </form>

          <form method="post" action={`${itemBase}/delete`} class="inline-form">
            <button
              type="submit"
              class="btn-chip btn-danger-subtle"
              aria-label={t("owner.delete_item", { name: item.name })}
            >
              {t("common.delete")}
            </button>
          </form>
        </div>
      </div>

      <InlineDraftEdit
        action={itemBase}
        idPrefix={`edit-item-${item.id}`}
        draft={item}
        nameLabel={t("owner.add_item_label")}
        t={t}
      />
    </li>
  );
}

export function OwnerView(p: OwnerPage) {
  const { t } = p.chrome;
  return (
    <Layout chrome={p.chrome} title={t("owner.page_title", { title: p.list.title })}>
      {renderOwnerFlash(p.flash, t)}

      <header class="list-head">
        <a href="/dashboard" class="back-link">
          {t("owner.back_to_lists")}
        </a>
        <h1>{p.list.title}</h1>
        <div class="list-meta">
          {renderDaysLeft(p.daysLeft, t)}
          {p.list.occasionDate && (
            <span class="meta-text">
              {formatOccasionDate(p.list.occasionDate, p.chrome.locale)}
            </span>
          )}
          <span class="meta-total tabular">
            {t("owner.total_label", { amount: formatMoney(p.totalCents, p.list.locale) })}
          </span>
        </div>
      </header>

      <section class="page-section" aria-labelledby="wishes-heading">
        <h2 id="wishes-heading">{t("owner.checklist_heading")}</h2>

        <DraftAddRow
          action={`/o/${p.list.id}/items`}
          idPrefix="owner-add-item"
          nameLabel={t("owner.add_item_label")}
          namePlaceholder={t("owner.add_item_placeholder")}
          submitLabel={t("owner.add_item_submit")}
          t={t}
        />

        {p.items.length === 0 ? (
          <p class="empty-state">{t("owner.empty_items")}</p>
        ) : (
          <ul class="checklist">
            {p.items.map((item, idx) => (
              <OwnerChecklistRow
                key={item.id}
                item={item}
                index={idx}
                count={p.items.length}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="page-section" aria-labelledby="invite-heading">
        <div class="section-head">
          <h2 id="invite-heading">{t("owner.invite_heading")}</h2>
          <p class="section-intro">{t("owner.invite_intro")}</p>
        </div>

        <div class="surface-card invite-panel">
          <div class="field-group">
            <label for="invite-url-input">{t("owner.invite_url_label")}</label>
            <input
              id="invite-url-input"
              type="url"
              readonly
              value={p.inviteUrl}
              class="secret-url-input"
            />
          </div>

          <div
            class="share-block"
            data-share-text={p.share.text}
            data-share-url={p.share.url}
          >
            <button
              type="button"
              class="btn-chip btn-chip-primary"
              hidden
              data-share-native
              data-share-text={p.share.text}
              data-share-url={p.share.url}
            >
              {t("owner.share_native")}
            </button>
            <button
              type="button"
              class="btn-chip"
              hidden
              data-share-copy
              data-share-text={p.inviteUrl}
              data-copied-label={t("common.copied")}
            >
              {t("common.copy_link")}
            </button>
            <a
              href={p.share.whatsapp}
              class="btn-chip"
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("owner.share_whatsapp")}
            </a>
            <a
              href={p.share.telegram}
              class="btn-chip"
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("owner.share_telegram")}
            </a>
            <a href={p.share.mailto} class="btn-chip">
              {t("owner.share_email")}
            </a>
          </div>

          <div class="invite-regen-bar">
            <p class="field-hint">{t("owner.regenerate_hint")}</p>
            <form method="post" action={`/o/${p.list.id}/invite`} class="inline-form">
              <button type="submit" class="btn-chip">
                {t("owner.regenerate_invite")}
              </button>
            </form>
          </div>
        </div>
      </section>

      <section class="page-section" aria-labelledby="list-locale-heading">
        <h2 id="list-locale-heading">{t("owner.locale_heading")}</h2>
        <p class="field-hint">{t("owner.locale_hint")}</p>
        <form method="post" action={`/o/${p.list.id}/locale`} class="inline-form">
          <label for="list-locale" class="sr-only">{t("dashboard.locale_label")}</label>
          <select id="list-locale" name="locale">
            {p.chrome.locales.map((entry) => (
              <option key={entry.code} value={entry.code} selected={entry.code === p.list.locale}>
                {entry.name}
              </option>
            ))}
          </select>
          <button type="submit" class="btn-chip">{t("owner.locale_save")}</button>
        </form>
      </section>

      <section class="page-section danger-section" aria-label={t("owner.delete_list_toggle")}>
        <details class="inline-edit">
          <summary class="btn-chip btn-danger-subtle">{t("owner.delete_list_toggle")}</summary>
          <div class="edit-form">
            <p class="field-hint">{t("owner.delete_list_warning")}</p>
            <form method="post" action={`/o/${p.list.id}/delete`} class="inline-form">
              <button type="submit" class="btn btn-primary">
                {t("owner.delete_list_confirm")}
              </button>
            </form>
          </div>
        </details>
      </section>
    </Layout>
  );
}

function renderInviteRegisterError(error: InvitePage["registerError"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "email-taken":
      return renderAlert(t("invite_page.error_email_taken"));
    case "captcha":
      return renderAlert(t("error.captcha"));
    case "throttled":
      return renderAlert(t("error.throttled"));
    case "full":
      return renderAlert(t("invite_page.error_full"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

function renderGuestLoginError(error: GuestLoginPage["error"], t: Translate) {
  if (!error) return null;
  switch (error) {
    case "invalid":
      return renderAlert(t("error.invalid"));
    case "wrong-credentials":
      return renderAlert(t("guest_login.error_wrong_credentials"));
    case "throttled":
      return renderAlert(t("error.throttled"));
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function InviteView(p: InvitePage) {
  const { t } = p.chrome;
  const encodedToken = encodeURIComponent(p.token);
  const openSignIn = Boolean(p.loginError || p.registerError === "email-taken");

  return (
    <Layout
      chrome={p.chrome}
      title={t("invite_page.page_title", { title: p.list.title, owner: p.list.ownerName })}
      scripts={turnstileScripts(p.captchaSiteKey)}
    >
      <section class="hero-block hero-compact">
        <h1>{p.list.title}</h1>
        <p class="lead-copy">{t("invite_page.invited_by", { owner: p.list.ownerName })}</p>
        {p.list.occasionDate && (
          <div class="list-meta">
            <span class="pill pill-sun">
              {t("guest.occasion_date", {
                date: formatOccasionDate(p.list.occasionDate, p.chrome.locale),
              })}
            </span>
          </div>
        )}
      </section>

      {renderInviteRegisterError(p.registerError, t)}
      {renderGuestLoginError(p.loginError, t)}

      <div class="surface-card surface-card-accent">
        <h2 class="card-heading">{t("invite_page.register_heading")}</h2>
        <form method="post" action={`/i/${encodedToken}/register`} class="stack-form">
          <div class="field-row-compact">
            <div class="field-group">
              <label for="reg-first-name">{t("invite_page.first_name_label")}</label>
              <input
                id="reg-first-name"
                name="firstName"
                type="text"
                required
                maxlength={60}
                autocomplete="given-name"
                value={p.values.firstName}
                placeholder={t("invite_page.first_name_placeholder")}
              />
            </div>

            <div class="field-group">
              <label for="reg-last-name">{t("invite_page.last_name_label")}</label>
              <input
                id="reg-last-name"
                name="lastName"
                type="text"
                required
                maxlength={60}
                autocomplete="family-name"
                value={p.values.lastName}
                placeholder={t("invite_page.last_name_placeholder")}
              />
            </div>
          </div>

          <div class="field-group">
            <label for="reg-email">{t("invite_page.email_label")}</label>
            <input
              id="reg-email"
              name="email"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              value={p.values.email}
              placeholder={t("invite_page.email_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="reg-pin">{t("invite_page.pin_label")}</label>
            <input
              id="reg-pin"
              name="pin"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{4}"
              maxlength={4}
              autocomplete="off"
              required
              aria-describedby="reg-pin-hint"
              placeholder={t("invite_page.pin_placeholder")}
              class="pin-input tabular"
            />
            <p id="reg-pin-hint" class="field-hint">
              {t("invite_page.pin_hint")}
            </p>
          </div>

          <TurnstileWidget siteKey={p.captchaSiteKey} />

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">
              {t("invite_page.register_submit")}
            </button>
          </div>
        </form>
      </div>

      <details class="surface-card signin-disclosure" open={openSignIn}>
        <summary class="signin-summary">{t("invite_page.already_registered")}</summary>
        <form method="post" action={`/i/${encodedToken}/login`} class="stack-form signin-body">
          <div class="field-group">
            <label for="invite-login-email">{t("invite_page.email_label")}</label>
            <input
              id="invite-login-email"
              name="email"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              value={p.values.email}
              placeholder={t("invite_page.email_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="invite-login-pin">{t("guest_login.pin_label")}</label>
            <input
              id="invite-login-pin"
              name="pin"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{4}"
              maxlength={4}
              autocomplete="off"
              required
              placeholder={t("guest_login.pin_placeholder")}
              class="pin-input tabular"
            />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">
              {t("guest_login.submit")}
            </button>
          </div>
        </form>
      </details>
    </Layout>
  );
}

export function GuestLoginView(p: GuestLoginPage) {
  const { t } = p.chrome;
  return (
    <Layout
      chrome={p.chrome}
      title={t("guest_login.page_title", { title: p.list.title })}
    >
      <section class="hero-block">
        <h1>{p.list.title}</h1>
        <p class="lead-copy">{t("guest_login.subtitle", { owner: p.list.ownerName })}</p>
      </section>

      {renderGuestLoginError(p.error, t)}

      <div class="surface-card surface-card-accent">
        <form method="post" action={`/l/${p.list.id}/login`} class="stack-form">
          <div class="field-group">
            <label for="guest-login-email">{t("invite_page.email_label")}</label>
            <input
              id="guest-login-email"
              name="email"
              type="email"
              required
              maxlength={254}
              autocomplete="email"
              value={p.email}
              placeholder={t("invite_page.email_placeholder")}
            />
          </div>

          <div class="field-group">
            <label for="guest-login-pin">{t("guest_login.pin_label")}</label>
            <input
              id="guest-login-pin"
              name="pin"
              type="text"
              inputmode="numeric"
              pattern="[0-9]{4}"
              maxlength={4}
              autocomplete="off"
              required
              placeholder={t("guest_login.pin_placeholder")}
              class="pin-input tabular"
            />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-wide">
              {t("guest_login.submit")}
            </button>
          </div>
        </form>

        <p class="auth-links">
          {t("guest_login.need_invite_hint", { owner: p.list.ownerName })}
        </p>
      </div>
    </Layout>
  );
}

function renderGuestFlash(flash: GuestListPage["flash"], t: Translate) {
  if (!flash) return null;
  switch (flash) {
    case "already-taken":
      return renderAlert(t("error.already_taken"));
    case "invalid":
      return renderAlert(t("error.invalid"));
    default: {
      const _exhaustive: never = flash;
      return _exhaustive;
    }
  }
}

function GuestWishlistRow({
  item,
  listId,
  listLocale,
  t,
}: {
  item: GuestItem;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const { state } = item;
  const itemBase = `/l/${listId}/items/${item.id}`;

  switch (state.kind) {
    case "taken": {
      return (
        <li id={`item-${item.id}`} class="gift-row is-wrapped">
          <div class="gift-inner">
            <span class="sr-only">
              {t("guest.wrapped_sr_label", { name: item.name, by: state.byName })}
            </span>
            <span class="ribbon-stripe is-ribbon" aria-hidden="true"></span>

            <div class="wrapped-body" aria-hidden="true">
              <span class="round-state is-taken"></span>
              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && <span class="item-link">{formatHost(item.url)}</span>}
              </div>
            </div>

            <div class="gift-tag-dock">
              {item.received && <span class="pill pill-mint">{t("guest.received")}</span>}
              <span class="gift-tag is-ribbon">
                <span class="tag-hole" aria-hidden="true"></span>
                <span>{t("guest.tag_claimed_by", { name: state.byName })}</span>
              </span>
            </div>
          </div>
        </li>
      );
    }

    case "mine": {
      return (
        <li id={`item-${item.id}`} class="gift-row is-mine">
          <div class="gift-inner">
            <span class="ribbon-stripe is-mint" aria-hidden="true"></span>

            <div class="gift-main">
              <span class="round-state is-mine" aria-hidden="true">
                <CheckIcon />
              </span>

              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && (
                  <a
                    href={item.url}
                    class="item-link"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${t("common.open_link")}: ${item.name}`}
                  >
                    <span>{formatHost(item.url)}</span>
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>

              <div class="gift-actions">
                <span class="gift-tag is-mint">
                  <span class="tag-hole" aria-hidden="true"></span>
                  <span>{t("guest.tag_you")}</span>
                </span>
                {item.received ? (
                  <span class="pill pill-mint">{t("guest.received")}</span>
                ) : (
                  <form method="post" action={`${itemBase}/unclaim`} class="inline-form">
                    <button type="submit" class="btn-chip">
                      {t("guest.unclaim")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </li>
      );
    }

    case "free": {
      return (
        <li id={`item-${item.id}`} class={`gift-row is-free${item.received ? " is-received" : ""}`}>
          <div class="gift-inner">
            <div class="gift-main">
              <span
                class={`round-state${item.received ? " is-mine" : ""}`}
                aria-hidden="true"
              >
                {item.received && <CheckIcon />}
              </span>

              <div class="item-body">
                <div class="item-title-line">
                  <span class="item-name">{item.name}</span>
                  {item.priceCents !== null && (
                    <span class="item-price tabular">
                      {formatMoney(item.priceCents, listLocale)}
                    </span>
                  )}
                </div>
                {item.details && <p class="item-details">{item.details}</p>}
                {item.url && (
                  <a
                    href={item.url}
                    class="item-link"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${t("common.open_link")}: ${item.name}`}
                  >
                    <span>{formatHost(item.url)}</span>
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>

              <div class="gift-actions">
                {item.received ? (
                  <span class="pill pill-mint">{t("guest.received")}</span>
                ) : (
                  <form method="post" action={`${itemBase}/claim`} class="inline-form">
                    <button type="submit" class="btn btn-primary">
                      {t("guest.claim")}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </li>
      );
    }

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function SideGiftRow({
  idea,
  listId,
  listLocale,
  t,
}: {
  idea: SideGift;
  listId: string;
  listLocale: LocaleCode;
  t: Translate;
}) {
  const ideaBase = `/l/${listId}/ideas/${idea.id}`;
  return (
    <li id={`idea-${idea.id}`} class={`idea-row${idea.mine ? " is-own-idea" : ""}`}>
      <div class="idea-main">
        <div class="item-body">
          <div class="item-title-line">
            <span class="item-name">{idea.name}</span>
            {idea.priceCents !== null && (
              <span class="item-price tabular">{formatMoney(idea.priceCents, listLocale)}</span>
            )}
            <span class={`pill ${idea.mine ? "pill-mint" : "pill-sun"}`}>
              {idea.mine
                ? t("guest.idea_by_you", { name: idea.byName })
                : t("guest.idea_by", { name: idea.byName })}
            </span>
          </div>

          {idea.details && <p class="item-details">{idea.details}</p>}

          {idea.url && (
            <a
              href={idea.url}
              class="item-link"
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={`${t("common.open_link")}: ${idea.name}`}
            >
              <span>{formatHost(idea.url)}</span>
              <ExternalLinkIcon />
            </a>
          )}
        </div>

        {idea.mine && (
          <div class="row-controls">
            <form method="post" action={`${ideaBase}/delete`} class="inline-form">
              <button
                type="submit"
                class="btn-chip btn-danger-subtle"
                aria-label={t("guest.delete_idea", { name: idea.name })}
              >
                {t("common.delete")}
              </button>
            </form>
          </div>
        )}
      </div>

      {idea.mine && (
        <InlineDraftEdit
          action={ideaBase}
          idPrefix={`edit-idea-${idea.id}`}
          draft={idea}
          nameLabel={t("guest.add_idea_label")}
          t={t}
        />
      )}
    </li>
  );
}

export function GuestListView(p: GuestListPage) {
  const { t } = p.chrome;
  return (
    <Layout
      chrome={p.chrome}
      title={t("guest.page_title", { title: p.list.title, owner: p.list.ownerName })}
    >
      {renderGuestFlash(p.flash, t)}

      <header class="list-head">
        <h1>{p.list.title}</h1>
        <div class="list-meta">
          <span class="meta-text">
            {t("guest.context", { owner: p.list.ownerName, guest: p.guestName })}
          </span>
          {p.list.occasionDate && (
            <span class="pill pill-sun">
              {t("guest.occasion_date", {
                date: formatOccasionDate(p.list.occasionDate, p.chrome.locale),
              })}
            </span>
          )}
        </div>
      </header>

      <section class="page-section" aria-labelledby="wishlist-heading">
        <div class="section-head">
          <h2 id="wishlist-heading">{t("guest.wishlist_heading", { owner: p.list.ownerName })}</h2>
          <p class="section-intro">{t("guest.wishlist_hint", { owner: p.list.ownerName })}</p>
        </div>

        {p.items.length === 0 ? (
          <p class="empty-state">{t("guest.empty_items", { owner: p.list.ownerName })}</p>
        ) : (
          <ul class="gift-list">
            {p.items.map((item) => (
              <GuestWishlistRow
                key={item.id}
                item={item}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>

      <section class="page-section ideas-section" aria-labelledby="ideas-heading">
        <div class="section-head">
          <h2 id="ideas-heading">{t("guest.ideas_heading")}</h2>
          <p class="section-intro">{t("guest.ideas_intro", { owner: p.list.ownerName })}</p>
        </div>

        <DraftAddRow
          action={`/l/${p.list.id}/ideas`}
          idPrefix="guest-add-idea"
          nameLabel={t("guest.add_idea_label")}
          namePlaceholder={t("guest.add_idea_placeholder")}
          submitLabel={t("guest.add_idea_submit")}
          t={t}
        />

        {p.sideGifts.length === 0 ? (
          <p class="empty-state">{t("guest.empty_ideas")}</p>
        ) : (
          <ul class="ideas-list">
            {p.sideGifts.map((idea) => (
              <SideGiftRow
                key={idea.id}
                idea={idea}
                listId={p.list.id}
                listLocale={p.list.locale}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
