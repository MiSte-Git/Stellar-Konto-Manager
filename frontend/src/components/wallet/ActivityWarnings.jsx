import React from 'react';
import { useTranslation } from 'react-i18next';

// Gemeinsame Warnhinweise fuer Zahlungsverlaeufe und Claimable Balances.
// Nur Fakten mit Kontext, kein Urteil ueber Absender oder Token (Token-Trust-Prinzip).

const warnCls =
  'rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-200';
const neutralCls =
  'rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300';

export function LookalikeBadge() {
  const { t } = useTranslation(['wallet']);
  return (
    <span
      className={warnCls}
      title={t('wallet:activity.lookalikeHint', 'Diese Adresse beginnt und endet wie eine Adresse, an die du gesendet hast, ist aber eine andere. Kopiere Empfänger nie aus dem Verlauf.')}
      data-testid="activity-lookalike"
    >
      {t('wallet:activity.lookalike', 'Ähnliche Adresse')}
    </span>
  );
}

export function DustBadge() {
  const { t } = useTranslation(['wallet']);
  return (
    <span className={neutralCls} data-testid="activity-dust">
      {t('wallet:activity.dust', 'Kleinstbetrag')}
    </span>
  );
}

export function UrlBadge() {
  const { t } = useTranslation(['wallet']);
  return (
    <span
      className={warnCls}
      title={t('wallet:activity.urlHint', 'Das Memo enthält eine Webadresse. Für eine Zahlung ist das nicht nötig. Öffne den Link nicht.')}
      data-testid="activity-url"
    >
      {t('wallet:activity.url', 'Enthält Webadresse')}
    </span>
  );
}

export function FakeNativeBadge() {
  const { t } = useTranslation(['wallet']);
  return (
    <span
      className={warnCls}
      title={t('wallet:activity.fakeNativeHint', 'Das ist ein Token eines Herausgebers, nicht das native XLM des Netzwerks.')}
      data-testid="activity-fake-native"
    >
      {t('wallet:activity.fakeNative', 'Token, kein natives XLM')}
    </span>
  );
}

/** Tag aus dem StellarExpert-Directory. Nur der Eintrag dort, keine Bewertung der Adresse. */
export function DirectoryTagBadge({ tag }) {
  return <span className={neutralCls} data-testid="directory-tag">{tag}</span>;
}

/**
 * Hinweisleiste unter/ueber einem Verlauf: Lookalike-Warnung und Kleinstzahlungen ein-/ausblenden.
 * @param {{ dustCount: number, hideDust: boolean, onToggleDust: () => void, hasLookalikes: boolean, className?: string }} props
 */
export function ActivityNotices({ dustCount, hideDust, onToggleDust, hasLookalikes, className = '' }) {
  const { t } = useTranslation(['wallet']);
  if (!(dustCount > 0) && !hasLookalikes) return null;
  return (
    <div
      className={`space-y-1 border-t border-gray-100 bg-gray-50 px-5 py-2.5 text-xs text-gray-600 dark:border-gray-700/70 dark:bg-gray-900/40 dark:text-gray-400 ${className}`}
      data-testid="activity-notices"
    >
      {hasLookalikes && (
        <p className="font-medium text-amber-800 dark:text-amber-300">
          {t('wallet:activity.lookalikeWarning', 'Achtung: Mindestens ein Absender ähnelt einer Adresse, an die du gesendet hast. Kopiere Empfänger nie aus dem Verlauf, sondern aus einer sicheren Quelle.')}
        </p>
      )}
      {dustCount > 0 && (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>
            {hideDust
              ? t('wallet:activity.dustHidden', { count: dustCount, defaultValue: '{{count}} Kleinstzahlungen ausgeblendet (oft Spam).' })
              : t('wallet:activity.dustShown', { count: dustCount, defaultValue: '{{count}} Kleinstzahlungen werden angezeigt.' })}
          </span>
          <button
            type="button"
            onClick={onToggleDust}
            className="rounded-sm border-0 bg-transparent p-0 text-xs font-medium text-blue-700 underline-offset-2 hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300"
          >
            {hideDust ? t('wallet:activity.showDust', 'Anzeigen') : t('wallet:activity.hideDust', 'Ausblenden')}
          </button>
        </p>
      )}
    </div>
  );
}
