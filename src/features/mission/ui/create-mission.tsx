"use client";

import { ArrowRight, Check, Clock3, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "./brand";
import { MissionLaunchTransition } from "./mission-launch-transition";

export const EXAMPLE_MISSION = "Завтра к 18:00 мне нужно быть в Санкт-Петербурге. Я нахожусь в Москве. Бюджет до 15 000 ₽, без самолёта, приехать минимум за два часа и вернуться следующим утром.";

function previewChips(text: string) {
  const chips: string[] = [];
  const origin = text.match(/(?:нахожусь|сейчас|я)\s+в\s+([А-ЯЁ][А-Яа-яЁё-]+)/i)?.[1];
  const destination = text.match(/(?:быть|оказаться|успеть|приехать)\s+в\s+([А-ЯЁ][А-Яа-яЁё-]+(?:-[А-ЯЁ][А-Яа-яЁё-]+)?)/i)?.[1];
  const city = (value: string) => ({ москве: "Москва", "санкт-петербурге": "Санкт-Петербург", петербурге: "Санкт-Петербург" }[value.toLowerCase()] ?? value);
  if (origin && destination) chips.push(`${city(origin)} → ${city(destination)}`);
  const time = text.match(/(?:к|до)\s*(\d{1,2}(?::\d{2})?)/i)?.[1];
  if (time) chips.push(`Успеть к ${time.includes(":") ? time : `${time}:00`}`);
  const budget = text.match(/(?:бюджет(?:ом)?(?:\s+до)?|до)\s*(\d[\d\s.,]*?)\s*(₽|₼|\$|€|[A-Z]{3}|руб\w*|манат\w*|доллар\w*|евро|лари|лир\w*|тенге|драм\w*|дирхам\w*|юан\w*)/i);
  if (budget) {
    const currency = ({ RUB: "₽", AZN: "₼", USD: "$", EUR: "€", GEL: "лари", TRY: "лир", GBP: "фунтов", KZT: "тенге", AMD: "драмов", AED: "дирхамов", CNY: "юаней" } as Record<string, string>)[budget[2].toUpperCase()] ?? budget[2];
    chips.push(`≤ ${budget[1].trim()} ${currency}`);
  }
  if (/без самол[её]та|самол[её]том не/i.test(text)) chips.push("Без самолёта");
  if (/следующ[а-яё]* утром/i.test(text)) chips.push("Вернуться утром");
  if (/(?:отел|гостиниц|хостел|апартамент|ноч[её]вк)/i.test(text)) chips.push("С проживанием");
  return chips;
}

type CreateMissionProps = {
  onSubmit: (text: string) => void;
  initialText: string;
};

export function CreateMission({ onSubmit, initialText }: CreateMissionProps) {
  const [text, setText] = useState(initialText);
  const [launching, setLaunching] = useState(false);
  const launchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chips = useMemo(() => previewChips(text), [text]);

  useEffect(() => () => {
    if (launchTimer.current) clearTimeout(launchTimer.current);
  }, []);

  const launchMission = () => {
    const missionText = text.trim();
    if (missionText.length < 12 || launching) return;
    setLaunching(true);
    launchTimer.current = setTimeout(() => onSubmit(missionText), 1_150);
  };

  return (
    <main className="create-shell">
      <MissionLaunchTransition active={launching} routeLabel={chips[0]} />
      <nav className="app-nav"><Brand /><span className="nav-note"><span className="live-dot" /> актуальные данные Туту</span></nav>
      <section className="hero">
        <div className="hero-intro">
          <p className="eyebrow">Путешествие начинается с цели</p>
          <h1>Куда вам нужно <em>успеть?</em></h1>
          <p className="hero-copy">Опишите поездку обычными словами. Сервис найдёт один выполнимый план и отдельно проверит сроки, бюджет и ограничения.</p>
          <div className="trust-row" aria-label="Принципы сервиса">
            <span><ShieldCheck size={19} /><strong>Независимая проверка</strong><small>Вердикт формирует код</small></span>
            <span><WalletCards size={19} /><strong>Строгий бюджет</strong><small>Включая валюты и отели</small></span>
            <span><Clock3 size={19} /><strong>Дедлайны и запас</strong><small>До события и обратно</small></span>
          </div>
        </div>
        <form
          className="mission-form"
          onSubmit={(event) => {
            event.preventDefault();
            launchMission();
          }}
          aria-busy={launching}
        >
          <label className="field-label" htmlFor="mission-text">Задача поездки</label>
          <textarea id="mission-text" aria-label="Опишите задачу поездки" value={text} onChange={(event) => setText(event.target.value)} rows={7} />
          {chips.length > 0 && (
            <div className="constraints-preview">
              <div className="constraints-heading"><span>Распознано</span><small>{chips.length} условий</small></div>
              <div className="recognized">
                {chips.map((chip) => <span className="chip" key={chip}><Check size={14} />{chip}</span>)}
              </div>
            </div>
          )}
          <div className="form-footer">
            <span>Пишите так, как объяснили бы человеку</span>
            <button type="submit" disabled={launching || text.trim().length < 12}>Решить задачу <ArrowRight size={18} /></button>
          </div>
        </form>
      </section>
    </main>
  );
}
