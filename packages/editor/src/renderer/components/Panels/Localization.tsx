import { useEffect, useMemo, useState } from 'react';
import type {
  LocalizationSourceEntry,
  LocalizationTranslationEntry,
} from '@story-blueprint/common';
import { useStoryGraphStore } from '../../graph/StoryGraphStore';
import panelStyles from './Panel.module.css';
import styles from './Localization.module.css';

const localePattern = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

function TranslationRow({
  source,
  value,
  onCommit,
}: {
  source: LocalizationSourceEntry;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <article className={styles.row}>
      <div className={styles.context}>
        <strong>
          {source.storyName} / {source.graphName}
        </strong>
        <span>{source.context}</span>
        <code>{source.textId}</code>
      </div>
      <div className={styles.source}>{source.source}</div>
      <textarea
        value={draft}
        placeholder="Translation…"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    </article>
  );
}

export function Localization() {
  const { workspace, extractProjectLocalization, updateProjectLocalization, revealWorkspaceItem } =
    useStoryGraphStore();
  const localization = workspace?.localization?.document;
  const [sourceLocale, setSourceLocale] = useState('en');
  const [newLocale, setNewLocale] = useState('');
  const [selectedLocale, setSelectedLocale] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (localization) setSourceLocale(localization.sourceLocale);
  }, [localization?.sourceLocale]);
  useEffect(() => {
    if (!localization) return;
    if (!localization.locales.some((locale) => locale.locale === selectedLocale)) {
      setSelectedLocale(localization.locales[0]?.locale ?? '');
    }
  }, [localization, selectedLocale]);
  const locale = localization?.locales.find((candidate) => candidate.locale === selectedLocale);
  const translationMap = useMemo(
    () =>
      new Map(
        (locale?.translations ?? []).map((entry) => [
          `${entry.storyId}\0${entry.textId}`,
          entry.text,
        ]),
      ),
    [locale?.translations],
  );
  const visibleSources = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (localization?.sources ?? []).filter((source) => {
      const haystack =
        `${source.storyName} ${source.graphName} ${source.context} ${source.textId} ${source.source}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [localization?.sources, search]);

  if (!workspace?.project) {
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>Open a project to manage localization.</p>
        </div>
      </div>
    );
  }
  if (!localization) {
    return (
      <div className={panelStyles.panel}>
        <div className={panelStyles.body}>
          <div className={styles.setup}>
            <h3>Project Localization</h3>
            <p>Extract Dialogue and Choice text into a separate Git-friendly localization file.</p>
            <label>
              <span>Source Locale</span>
              <input
                value={sourceLocale}
                onChange={(event) => setSourceLocale(event.target.value)}
              />
            </label>
            <button
              disabled={!localePattern.test(sourceLocale)}
              onClick={() => void extractProjectLocalization(sourceLocale)}
            >
              Extract Project Text
            </button>
          </div>
        </div>
      </div>
    );
  }

  const updateTranslation = (source: LocalizationSourceEntry, text: string) => {
    if (!locale) return;
    const remaining = locale.translations.filter(
      (entry) => entry.storyId !== source.storyId || entry.textId !== source.textId,
    );
    const translations: LocalizationTranslationEntry[] = text
      ? [...remaining, { storyId: source.storyId, textId: source.textId, text }]
      : remaining;
    updateProjectLocalization({
      ...localization,
      locales: localization.locales.map((candidate) =>
        candidate.locale === locale.locale ? { ...candidate, translations } : candidate,
      ),
    });
  };
  const translatedCount = localization.sources.filter((source) =>
    translationMap.has(`${source.storyId}\0${source.textId}`),
  ).length;

  return (
    <div className={panelStyles.panel}>
      <div className={styles.toolbar}>
        <button onClick={() => void extractProjectLocalization(localization.sourceLocale)}>
          Update Sources
        </button>
        <button onClick={() => void revealWorkspaceItem(workspace.localization!.relativePath)}>
          Show File
        </button>
        <label className={styles.sourceLocale}>
          <span>Source</span>
          <input
            value={sourceLocale}
            onChange={(event) => setSourceLocale(event.target.value)}
            onBlur={() => {
              if (
                localePattern.test(sourceLocale) &&
                sourceLocale !== localization.sourceLocale &&
                !localization.locales.some((item) => item.locale === sourceLocale)
              ) {
                updateProjectLocalization({
                  ...localization,
                  sourceLocale,
                  locales: localization.locales.map((item) =>
                    item.fallback === localization.sourceLocale
                      ? { ...item, fallback: sourceLocale }
                      : item,
                  ),
                });
              } else setSourceLocale(localization.sourceLocale);
            }}
          />
        </label>
        <div className={styles.addLocale}>
          <input
            value={newLocale}
            placeholder="zh-CN"
            onChange={(event) => setNewLocale(event.target.value)}
          />
          <button
            disabled={!localePattern.test(newLocale)}
            onClick={() => {
              const name = newLocale.trim();
              if (
                name === localization.sourceLocale ||
                localization.locales.some((item) => item.locale === name)
              ) {
                setError('Locale already exists or matches the source locale.');
                return;
              }
              updateProjectLocalization({
                ...localization,
                locales: [
                  ...localization.locales,
                  { locale: name, fallback: localization.sourceLocale, translations: [] },
                ],
              });
              setSelectedLocale(name);
              setNewLocale('');
              setError(undefined);
            }}
          >
            Add Locale
          </button>
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {localization.locales.length === 0 ? (
        <div className={panelStyles.body}>
          <p className={panelStyles.placeholder}>Add a target locale to begin translating.</p>
        </div>
      ) : (
        <>
          <div className={styles.localeBar}>
            <select
              value={selectedLocale}
              onChange={(event) => setSelectedLocale(event.target.value)}
            >
              {localization.locales.map((item) => (
                <option key={item.locale}>{item.locale}</option>
              ))}
            </select>
            <label>
              <span>Fallback</span>
              <select
                value={locale?.fallback ?? ''}
                onChange={(event) =>
                  updateProjectLocalization({
                    ...localization,
                    locales: localization.locales.map((item) =>
                      item.locale === selectedLocale
                        ? { ...item, fallback: event.target.value || undefined }
                        : item,
                    ),
                  })
                }
              >
                <option value="">Source ({localization.sourceLocale})</option>
                <option value={localization.sourceLocale}>{localization.sourceLocale}</option>
                {localization.locales
                  .filter((item) => item.locale !== selectedLocale)
                  .map((item) => (
                    <option key={item.locale}>{item.locale}</option>
                  ))}
              </select>
            </label>
            <span>
              {translatedCount} / {localization.sources.length}
            </span>
            <input
              className={styles.search}
              value={search}
              placeholder="Filter text…"
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              className={styles.remove}
              onClick={() => {
                if (!window.confirm(`Remove locale ${selectedLocale} and all of its translations?`))
                  return;
                updateProjectLocalization({
                  ...localization,
                  locales: localization.locales
                    .filter((item) => item.locale !== selectedLocale)
                    .map((item) =>
                      item.fallback === selectedLocale
                        ? { ...item, fallback: localization.sourceLocale }
                        : item,
                    ),
                });
              }}
            >
              Remove Locale
            </button>
          </div>
          <div className={styles.tableHeader}>
            <span>Context</span>
            <span>Source</span>
            <span>{selectedLocale}</span>
          </div>
          <div className={styles.rows}>
            {visibleSources.map((source) => {
              const key = `${source.storyId}\0${source.textId}`;
              return (
                <TranslationRow
                  key={key}
                  source={source}
                  value={translationMap.get(key) ?? ''}
                  onCommit={(value) => updateTranslation(source, value)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
