'use client';
// Shows the five weights' running total as Dane types, and stops the browser
// sending a total that is not 100, so the lists he typed are not lost to a
// refused save. The server checks again (lib/preferences.ts): this is only a
// convenience, never the rule.
import { useEffect, useRef, useState } from 'react';

export function WeightsTotal({ names }: { names: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const inputs = names
      .map((n) => form.elements.namedItem(n))
      .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
    const update = () => {
      const sum = inputs.reduce((s, el) => s + (Number(el.value) || 0), 0);
      setTotal(sum);
      const msg = sum === 100 ? '' : `The five weights add up to ${sum}; they must add up to 100.`;
      inputs[0]?.setCustomValidity(msg);
    };
    update();
    form.addEventListener('input', update);
    return () => form.removeEventListener('input', update);
  }, [names]);

  return (
    <p ref={ref} aria-live="polite" style={{ fontWeight: 'bold', color: total === null || total === 100 ? undefined : '#a40000' }}>
      {total === null ? null : total === 100 ? 'Total: 100' : `Total: ${total} (must be 100)`}
    </p>
  );
}
