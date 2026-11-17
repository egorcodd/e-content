import { useId, useState } from 'react';
import { ParameterRange } from './ParameterRange';
import { tiktokCollectionLimits, type TikTokSelection } from './tiktok-contracts';

function validateLimit(value: string, max: number) {
  if (value === '') return 'Введите число.';
  if (!/^\d+$/.test(value)) return 'Введите целое число.';
  if (Number(value) < 1 || Number(value) > max)
    return `Допустимо от 1 до ${max.toLocaleString('ru')}.`;
  return '';
}

function LimitField({
  label,
  value,
  savedValue,
  max,
  runLimit,
  error,
  submitted,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  savedValue: number;
  max: number;
  runLimit?: number;
  error: string;
  submitted: boolean;
  disabled: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const message = (touched || submitted) && error;
  return (
    <div className="tt-limit-field">
      <div className="tt-limit-field-head">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(message)}
          aria-describedby={message || hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => setTouched(true)}
        />
      </div>
      <ParameterRange
        label={label}
        value={error ? savedValue : Number(value)}
        min={1}
        max={max}
        volumeBudget={runLimit}
        disabled={disabled}
        showHeading={false}
        onChange={(next) => onChange(String(next))}
      />
      {message ? (
        <small id={`${id}-hint`} className="tt-limit-error" role="alert">
          {message}
        </small>
      ) : (
        hint && <small id={`${id}-hint`}>{hint}</small>
      )}
    </div>
  );
}

export function TikTokCollectionLimits({
  selection,
  busy,
  commentsEnabled,
  includeReplies,
  runCommentLimit,
  save,
}: {
  selection: TikTokSelection;
  busy: boolean;
  commentsEnabled: boolean;
  includeReplies: boolean;
  runCommentLimit: number;
  save: (patch: Partial<TikTokSelection>) => Promise<boolean>;
}) {
  const [latestDraft, setLatestDraft] = useState<string>();
  const [commentsDraft, setCommentsDraft] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const savedComments =
    selection.commentsPerVideo ?? tiktokCollectionLimits.defaultCommentsPerVideo;
  const latest = latestDraft ?? String(selection.latest);
  const comments = commentsDraft ?? String(savedComments);
  const latestError = validateLimit(latest, tiktokCollectionLimits.videos);
  const commentsError = commentsEnabled
    ? validateLimit(comments, tiktokCollectionLimits.commentsPerVideo)
    : '';
  const dirty =
    latest !== String(selection.latest) || (commentsEnabled && comments !== String(savedComments));

  return (
    <form
      className="tt-collection-limits"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!dirty || busy) return;
        setSubmitted(true);
        if (latestError || commentsError) return;
        if (
          await save({
            latest: Number(latest),
            ...(commentsEnabled && { commentsPerVideo: Number(comments) }),
          })
        ) {
          setLatestDraft(undefined);
          setCommentsDraft(undefined);
          setSubmitted(false);
        }
      }}
    >
      <div className="tt-limit-fields">
        <LimitField
          label="Последние ролики"
          value={latest}
          savedValue={selection.latest}
          max={tiktokCollectionLimits.videos}
          error={latestError}
          submitted={submitted}
          disabled={busy}
          onChange={setLatestDraft}
        />
        {commentsEnabled && (
          <LimitField
            label="Комментариев на ролик"
            value={comments}
            savedValue={savedComments}
            max={tiktokCollectionLimits.commentsPerVideo}
            runLimit={runCommentLimit}
            error={commentsError}
            submitted={submitted}
            disabled={busy}
            hint={includeReplies ? 'Включая ответы' : undefined}
            onChange={setCommentsDraft}
          />
        )}
      </div>
      <button className="ec-button ec-white" type="submit" disabled={!dirty || busy}>
        {busy ? 'Применяем…' : 'Применить к сбору'}
      </button>
    </form>
  );
}
