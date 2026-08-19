"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/mission/format";
import type { MissionResponse } from "@/lib/mission/schema";
import { Brand } from "./brand";
import { gsap, useGSAP, useScreenEntrance } from "./motion";

type SolvingScreenProps = {
  text: string;
  response: MissionResponse | null;
  onDone: () => void;
};

export function SolvingScreen({ text, response, onDone }: SolvingScreenProps) {
  const root = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const hasConversion = Boolean(response?.constraints.budgetConversion);
  const hasHotel = Boolean(response?.constraints.accommodation);
  const stepCount = 7 + (hasConversion ? 1 : 0) + (hasHotel ? 1 : 0);
  useEffect(() => {
    if (!response) return;
    const timers = Array.from({ length: stepCount }, (_, value) => setTimeout(() => setStep(value + 1), value * 420));
    const done = setTimeout(onDone, stepCount * 420 + 260);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [response, onDone, stepCount]);
  const stats = response?.stats;
  const rows: string[][] = [
    ["Понимаю условия", response ? `${Object.keys(response.constraints).length - 3} ограничений · ${response.parserSource === "agent-adjustment" ? "агент скорректировал" : response.parserSource === "bedrock-claude" ? "обработано ИИ" : "резервная обработка"}` : "разбираю смысл"],
    ...(response?.constraints.budgetConversion ? [["Конвертирую бюджет", `${formatMoney(response.constraints.budgetConversion.rubAmount)} по курсу ЦБ РФ`]] : []),
    ["Ищу поезда", stats ? `${stats.offersByMode.railway} вариантов` : "данные Туту"],
    ["Ищу автобусы и электрички", stats ? `${stats.offersByMode.bus + stats.offersByMode.etrain} вариантов` : "данные Туту"],
    ...(response?.constraints.accommodation ? [["Ищу отели", `${stats?.hotelOffers ?? 0} вариантов · данные Туту`]] : []),
    ["Собираю поездки", stats ? `${stats.outboundOffers} туда · ${stats.returnOffers} обратно · ${stats.combinations} комбинаций` : "туда + обратно"],
    ["Проверяю дедлайн", stats ? `${stats.afterDeadline} осталось` : "строго по времени"],
    ["Проверяю бюджет и условия", stats ? `${stats.feasible} подходят` : "детерминированно"],
    ["Выбираю оптимальную", response ? (response.status === "complete" ? "маршрут найден" : "ищу минимальное изменение") : "оцениваю варианты"],
  ];

  useScreenEntrance(root);
  useGSAP(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const current = root.current?.querySelector(`[data-step="${step}"]`);
    if (current) gsap.fromTo(current, { x: 8 }, { x: 0, duration: 0.35, ease: "power2.out", clearProps: "transform" });
  }, { scope: root, dependencies: [step] });

  return (
    <main className="solve-shell" ref={root}>
      <nav className="app-nav"><Brand /><span className="mission-label"><span className="live-dot" /> Решаем задачу</span></nav>
      <section className="solve-grid">
        <div className="solve-intro" data-enter>
          <div className="orb"><span /><LoaderCircle className={!response ? "spin" : ""} size={36} /></div>
          <p className="kicker">Задача решается</p>
          <h1>{response ? "Проверяем решение" : "Ищем лучший путь"}</h1>
          <p>Каждый вариант проходит одинаковые программные проверки. На экране только фактические этапы текущего поиска.</p>
          <blockquote>«{text}»</blockquote>
        </div>
        <div className="progress-card" data-enter aria-live="polite">
          <div className="progress-head"><strong>Ход решения</strong><span>{Math.min(step, rows.length)} из {rows.length}</span></div>
          {rows.map(([label, detail], index) => {
            const complete = response ? index < step : index === 0;
            const active = response ? index === step : index === 0;
            return (
              <div className={`progress-row ${complete ? "complete" : ""} ${active ? "active" : ""}`} data-step={index} key={label}>
                <span className="status-icon">{complete ? <Check size={15} /> : active ? <LoaderCircle className="spin" size={15} /> : <span />}</span>
                <div><strong>{label}</strong><small>{detail}</small></div>
              </div>
            );
          })}
          <div className="data-note"><span className="live-dot" /> Показаны актуальные данные текущего ответа Туту</div>
        </div>
      </section>
    </main>
  );
}
