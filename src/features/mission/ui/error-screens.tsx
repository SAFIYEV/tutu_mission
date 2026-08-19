"use client";

import { ArrowRight, CircleAlert, CircleHelp, RotateCcw } from "lucide-react";
import { useRef } from "react";
import { Brand } from "./brand";
import { useScreenEntrance } from "./motion";

type TechnicalErrorProps = {
  message: string;
  code: string;
  onRetry: () => void;
  onReset: () => void;
};

export function TechnicalError({ message, code, onRetry, onReset }: TechnicalErrorProps) {
  const root = useRef<HTMLElement>(null);
  const currencyError = code === "CURRENCY_RATE_UNAVAILABLE";
  useScreenEntrance(root);
  return (
    <main className="result-shell impossible-shell" ref={root}>
      <nav className="app-nav"><Brand /><button className="ghost-button" onClick={onReset}><RotateCcw size={15} /> Изменить задачу</button></nav>
      <section className="state-layout technical-card">
        <div className="state-intro" data-enter>
          <div className="alert-icon"><CircleAlert size={25} /></div>
          <p className="kicker">{currencyError ? "Курс временно недоступен" : "Поиск временно недоступен"}</p>
          <h1>{currencyError ? "Не удалось получить курс валют" : "Не удалось получить данные Туту"}</h1>
          <p className="impossible-copy">{message}</p>
        </div>
        <div className="state-panel" data-enter>
          <h2>Условия сохранены</h2>
          <p>Мы не выдаём технический сбой за невозможную поездку и не используем выдуманные данные. Поиск можно безопасно повторить.</p>
          <button className="primary-button" onClick={onRetry}>Повторить поиск <RotateCcw size={17} /></button>
        </div>
      </section>
    </main>
  );
}

type ClarificationProps = {
  questions: string[];
  onEdit: () => void;
  unsupported: boolean;
};

export function Clarification({ questions, onEdit, unsupported }: ClarificationProps) {
  const root = useRef<HTMLElement>(null);
  useScreenEntrance(root);
  return (
    <main className="result-shell impossible-shell" ref={root}>
      <nav className="app-nav"><Brand /></nav>
      <section className="state-layout clarification-card">
        <div className="state-intro" data-enter>
          <div className="alert-icon"><CircleHelp size={25} /></div>
          <p className="kicker">{unsupported ? "Граница продукта" : "Нужно уточнение"}</p>
          <h1>{unsupported ? "Не можем это честно проверить" : "Не будем додумывать за вас"}</h1>
          <p className="impossible-copy">{unsupported ? "Лучше явно показать границу продукта, чем выдать неполный маршрут за готовое решение." : "Для программной проверки не хватает точных условий."}</p>
        </div>
        <div className="state-panel" data-enter>
          <h2>{unsupported ? "Что нужно изменить" : "Что нужно добавить"}</h2>
          <div className="clarification-list">
            {questions.map((question) => <div key={question}><span>?</span>{question}</div>)}
          </div>
          <button className="primary-button" onClick={onEdit}>{unsupported ? "Изменить условия" : "Дополнить задачу"} <ArrowRight size={17} /></button>
        </div>
      </section>
    </main>
  );
}
