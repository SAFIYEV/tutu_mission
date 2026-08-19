"use client";

import {
  ArrowDown,
  ArrowRight,
  BusFront,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Clock3,
  ExternalLink,
  Plane,
  RotateCcw,
  ShieldCheck,
  TrainFront,
  WalletCards,
  Star,
  Coffee,
} from "lucide-react";
import { useRef } from "react";
import { formatDuration, formatMoney, formatTime, formatTransfers, modeLabel } from "@/lib/mission/format";
import type { MissionCandidate, MissionResponse } from "@/lib/mission/schema";
import { Brand } from "./brand";
import { useScreenEntrance } from "./motion";

const modeIcon = {
  avia: Plane,
  railway: TrainFront,
  bus: BusFront,
  etrain: TrainFront,
};

function CurrencyConversionNote({ data }: { data: MissionResponse }) {
  const conversion = data.constraints.budgetConversion;
  if (!conversion) return null;
  const original = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(conversion.originalAmount);
  const rate = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(conversion.rateRubPerUnit);
  const currency = ({
    RUB: "российский рубль",
    AZN: "азербайджанский манат",
    USD: "доллар США",
    EUR: "евро",
    GEL: "грузинский лари",
    TRY: "турецкая лира",
    GBP: "фунт стерлингов",
    KZT: "казахстанский тенге",
    AMD: "армянский драм",
    AED: "дирхам ОАЭ",
    CNY: "китайский юань",
  } as Record<string, string>)[conversion.originalCurrency] ?? "иностранная валюта";
  return (
    <div className="currency-note">
      <WalletCards size={18} />
      <div>
        <strong>{original} · {currency} = {formatMoney(conversion.rubAmount)}</strong>
        <span>Курс единицы валюты: {rate} ₽ · ЦБ РФ на {conversion.rateDate}</span>
      </div>
      <a href={conversion.sourceUrl} target="_blank" rel="noreferrer" aria-label="Источник курса валют"><ExternalLink size={14} /></a>
    </div>
  );
}

function RouteLeg({ candidate, direction }: { candidate: MissionCandidate; direction: "outbound" | "return" }) {
  const option = direction === "outbound" ? candidate.outbound : candidate.return!;
  const Icon = modeIcon[option.mode];
  return (
    <div className="route-leg">
      <div className="leg-head"><span>{direction === "outbound" ? "Туда" : "Обратно"}</span><span>{formatDuration(option.durationMin)}</span></div>
      <div className="route-line">
        <div className="route-stop"><strong>{formatTime(option.departureAt)}</strong><span>{option.from}</span></div>
        <div className="transport-rail"><span className="vehicle"><Icon size={17} /> {modeLabel[option.mode]}</span><i /></div>
        <div className="route-stop align-right"><strong>{formatTime(option.arrivalAt)}</strong><span>{option.to}</span></div>
      </div>
      <div className="leg-meta">{option.carrier ?? "Перевозчик не указан"} · {option.transfers ? formatTransfers(option.transfers) : "без пересадок"}</div>
    </div>
  );
}

function CandidateLinks({ candidate }: { candidate: MissionCandidate }) {
  const links = [candidate.outbound, candidate.return].filter(Boolean);
  return (
    <div className="booking-links">
      {links.map((option, index) => (
        <a href={option!.checkoutUrl ?? option!.searchResultsUrl ?? "https://www.tutu.ru"} target="_blank" rel="noreferrer" key={option!.id}>
          {index ? "Обратный билет на Туту" : "Перейти к билету на Туту"}<ExternalLink size={15} />
        </a>
      ))}
      {candidate.hotel && (
        <a href={candidate.hotel.checkoutUrl} target="_blank" rel="noreferrer">
          Открыть отель на Туту<ExternalLink size={15} />
        </a>
      )}
    </div>
  );
}

function HotelStay({ candidate }: { candidate: MissionCandidate }) {
  const hotel = candidate.hotel;
  if (!hotel) return null;
  return (
    <div className="hotel-stay">
      <div className="hotel-icon"><Building2 size={21} /></div>
      <div className="hotel-copy">
        <span>Проживание · {hotel.nights} ноч.</span>
        <strong>{hotel.name}</strong>
        <small>{hotel.address ?? "Адрес указан на странице Туту"}</small>
        <div className="hotel-facts">
          {hotel.stars != null && <span><Star size={13} /> {hotel.stars}★</span>}
          {hotel.rating != null && <span>Рейтинг {hotel.rating.toFixed(1)}</span>}
          <span><CalendarDays size={13} /> {hotel.checkIn} — {hotel.checkOut}</span>
          {hotel.breakfastIncluded && <span><Coffee size={13} /> Завтрак включён</span>}
          {hotel.freeCancellation && <span>Бесплатная отмена</span>}
        </div>
      </div>
      <strong className="hotel-price">{formatMoney(hotel.price)}</strong>
    </div>
  );
}

export function CompleteResult({ data, onReset }: { data: MissionResponse; onReset: () => void }) {
  const root = useRef<HTMLElement>(null);
  const winner = data.winner!;
  const buffer = Math.floor((new Date(data.constraints.eventAt).getTime() - new Date(winner.outbound.arrivalAt).getTime()) / 60_000);
  useScreenEntrance(root);
  return (
    <main className="result-shell" ref={root}>
      <nav className="app-nav"><Brand /><button className="ghost-button" onClick={onReset}><RotateCcw size={15} /> Новая задача</button></nav>
      <section className="result-grid">
        <div className="result-main">
          <div className="success-title" data-enter><span><Check size={19} /></span><div><p>Задача выполнена</p><h1>Маршрут готов</h1></div></div>
          {data.warnings.length > 0 && <div className="partial-warning"><CircleAlert size={17} /><span><strong>Часть поиска была недоступна.</strong> Этот маршрут проверен, но может быть не лучшим среди абсолютно всех предложений.</span></div>}
          <div className="route-card" data-enter>
            <div className="route-cities"><div><small>Старт</small><strong>{data.constraints.origin}</strong></div><ArrowRight /><div><small>Цель</small><strong>{data.constraints.destination}</strong></div><div className="price"><small>Вся поездка</small><strong>{formatMoney(winner.totalPrice)}</strong></div></div>
            <CurrencyConversionNote data={data} />
            <RouteLeg candidate={winner} direction="outbound" />
            {winner.return && <RouteLeg candidate={winner} direction="return" />}
            <HotelStay candidate={winner} />
            <div className="event-band"><Clock3 size={19} /><div><strong>Прибытие за {formatDuration(buffer)} до события</strong><span>Событие в {formatTime(data.constraints.eventAt)} · необходимый запас {formatDuration(data.constraints.arrivalBufferMin)}</span></div></div>
            <CandidateLinks candidate={winner} />
          </div>
          <div className="why-card" data-enter><CircleHelp size={19} /><div><strong>Почему этот маршрут</strong><p>{data.explanation}</p></div></div>
          {data.planB && <details className="plan-b" data-enter><summary>Запасной план · ещё один проверенный вариант <ChevronDown size={17} /></summary><div><span>{modeLabel[data.planB.outbound.mode]} · {formatTime(data.planB.outbound.departureAt)} → {formatTime(data.planB.outbound.arrivalAt)}</span><strong>{formatMoney(data.planB.totalPrice)}</strong></div></details>}
        </div>
        <aside className="verify-card" data-enter>
          <div className="verify-head"><ShieldCheck size={23} /><div><p>Маршрут проверен</p><span>Независимая проверка кодом</span></div></div>
          <div className="checks">
            {data.verification?.checks.map((check) => <div key={check.key}><CheckCircle2 size={18} /><span>{check.label}</span></div>)}
          </div>
          <div className="verified-stamp"><Check size={16} /> Все условия выполнены</div>
          <p className="source-note">Маршрут и ссылки: Туту<br />Вердикт: независимая проверка</p>
        </aside>
      </section>
    </main>
  );
}

type ImpossibleResultProps = {
  data: MissionResponse;
  onReset: () => void;
  onApplySuggestion: () => void;
};

export function ImpossibleResult({ data, onReset, onApplySuggestion }: ImpossibleResultProps) {
  const root = useRef<HTMLElement>(null);
  const diagnosticCopy = data.stats.combinations === 0
    ? data.stats.outboundOffers === 0
      ? "Туту не вернул ни одного предложения в направлении туда для выбранных дат. Без реального варианта агент не будет выдумывать коррекцию."
      : data.constraints.returnArrivalDeadline && data.stats.returnOffers === 0
        ? `Найдено ${data.stats.outboundOffers} вариантов туда, но ни одного обратного рейса в заданное окно.`
        : data.constraints.accommodation && (data.stats.hotelOffers ?? 0) === 0
          ? "Транспорт найден, но отелей с заданными датами и предпочтениями в текущем ответе Туту нет."
        : `Найдено ${data.stats.rawOffers} предложений, но из них не удалось собрать полную поездку туда и обратно.`
    : `Проверено ${data.stats.combinations} комбинаций. Мы не останавливаемся на «ничего не найдено» — ищем минимальное изменение.`;
  useScreenEntrance(root);
  return (
    <main className="result-shell impossible-shell" ref={root}>
      <nav className="app-nav"><Brand /><button className="ghost-button" onClick={onReset}><RotateCcw size={15} /> Изменить задачу</button></nav>
      <section className="state-layout">
        <div className="state-intro" data-enter>
          <div className="alert-icon"><CircleAlert size={25} /></div>
          <p className="kicker">Задача невыполнима</p>
          <h1>В текущих условиях маршрута нет</h1>
          <p className="impossible-copy">{diagnosticCopy}</p>
          <CurrencyConversionNote data={data} />
        </div>
        <div className="state-panel" data-enter>
          <p className="panel-label">Минимальное изменение</p>
          {data.suggestion ? (
            <div className="relaxation">
              <strong>{data.suggestion.title}</strong>
              {data.suggestion.changes && <div className="relaxation-list">{data.suggestion.changes.map((change) => <span key={change.key}><Check size={15} />{change.label}</span>)}</div>}
              <ArrowDown size={20} />
              <span>{data.suggestion.detail}</span>
            </div>
          ) : <div className="relaxation"><strong>Нужно изменить несколько условий</strong><span>{data.explanation}</span></div>}
          <button className="primary-button" onClick={data.suggestion ? onApplySuggestion : onReset}>
            {data.suggestion ? "Применить и решить заново" : "Изменить запрос вручную"} <ArrowRight size={17} />
          </button>
        </div>
      </section>
    </main>
  );
}
