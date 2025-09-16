// ============================================================================
// Financeiro Pessoal – PWA iPhone (App só seu)
// Arquivo único React com comentários em linha explicando cada parte.
// Observações:
//  - Este app usa armazenamento local (localStorage) — seus dados ficam só no aparelho.
//  - Você pode importar CSV (extratos) e exportar/backup JSON.
//  - Para virar "app" no iPhone: publicar (Vercel/Netlify), abrir no Safari e
//    Compartilhar → Adicionar à Tela de Início.
//  - Bibliotecas usadas: framer-motion, recharts, lucide-react, papaparse.
// ============================================================================

import React, { useMemo, useRef, useState, useEffect } from "react";
import { motion } from "framer-motion"; // animações sutis de entrada
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
} from "recharts"; // gráficos para dashboards
import {
  Upload,
  Settings,
  Plus,
  Trash2,
  RefreshCcw,
  FileDown,
  WalletCards,
  Download,
} from "lucide-react"; // ícones SVG leves
import Papa from "papaparse"; // parser de CSV no browser

// ------------------------------
// Tipos e utilitários
// ------------------------------
// Representa uma transação financeira. amount > 0 = receita, < 0 = despesa
export type Tx = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  amount: number; // positivo receita / negativo despesa
  description: string;
  account?: string; // nome/alias da conta (opcional)
  method?: string; // pix, débito, crédito, etc. (opcional)
  category?: string; // nome da categoria (texto)
  raw?: any; // linha bruta do CSV (para auditoria)
};

// Mapa de orçamento: categoria -> percentual (0..1)
export type Budget = Record<string, number>;

// Regra de categorização por palavras‑chave
export type Rule = {
  id: string;
  keywords: string; // "ifood, uber" (separado por vírgula)
  category: string; // categoria de destino
  enabled: boolean; // ativa/inativa
  priority: number; // menor número = executa primeiro
};

// Categorias padrão (você pode editar no orçamento)
const DEFAULT_CATEGORIES = [
  "Moradia",
  "Alimentação",
  "Transporte",
  "Saúde",
  "Educação",
  "Lazer",
  "Compras Pessoais",
  "Assinaturas e Serviços",
  "Impostos/Taxas",
  "Emergências/Imprevistos",
  "Investimentos/Reserva",
  "Outros",
];

// Percentuais de orçamento sugeridos (somatório <= 1)
const DEFAULT_BUDGET: Budget = {
  Moradia: 0.3,
  Alimentação: 0.15,
  Transporte: 0.1,
  Saúde: 0.08,
  Educação: 0.05,
  Lazer: 0.08,
  "Compras Pessoais": 0.06,
  "Assinaturas e Serviços": 0.05,
  "Impostos/Taxas": 0.05,
  "Emergências/Imprevistos": 0.04,
  "Investimentos/Reserva": 0.04,
  Outros: 0,
};

// Paleta para gráficos (12 cores)
const COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#0ea5e9",
  "#10b981",
  "#eab308",
  "#f97316",
  "#22c55e",
  "#64748b",
  "#334155",
];

// Gera um id simples e único por sessão
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36).slice(2);
}

// Formata números como BRL quando exibidos (não usar em inputs editáveis)
function formatBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Extrai ano-mês em formato "YYYY-MM" de uma data ISO
function ym(date: string) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ------------------------------
// Persistência local (apenas neste aparelho)
// ------------------------------
// Chaves de armazenamento no localStorage
const LS_KEYS = {
  tx: "finance_app_tx",
  budget: "finance_app_budget",
  rules: "finance_app_rules",
};

// Hook genérico para sincronizar estado com localStorage
function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // silencioso: iOS pode restringir armazenamento em modo privado
    }
  }, [key, state]);

  return [state, setState] as const;
}

// ============================================================================
// Componente principal do App
// ============================================================================
export default function AppFinanceiroPessoal() {
  // Abas da interface
  const [tab, setTab] = useState<
    "resumo" | "transacoes" | "orcamento" | "regras" | "config"
  >("resumo");

  // Estados persistidos
  const [tx, setTx] = useLocalStorage<Tx[]>(LS_KEYS.tx, []);
  const [budget, setBudget] = useLocalStorage<Budget>(LS_KEYS.budget, DEFAULT_BUDGET);
  const [rules, setRules] = useLocalStorage<Rule[]>(LS_KEYS.rules, []);

  // Mês selecionado (YYYY-MM) – inicia no mês atual
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // Referência ao input de arquivo para importação de CSV
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Lista das transações do mês filtrado (evita recomputar em cada render)
  const txMonth = useMemo(() => tx.filter((t) => ym(t.date) === month), [tx, month]);

  // Agregações: receita/despesa/resultado do mês
  const receitaMes = useMemo(
    () => txMonth.filter((t) => t.amount > 0).reduce((a, b) => a + b.amount, 0),
    [txMonth]
  );
  const despesaMes = useMemo(
    () => txMonth.filter((t) => t.amount < 0).reduce((a, b) => a + Math.abs(b.amount), 0),
    [txMonth]
  );
  const resultadoMes = receitaMes - despesaMes;

  // Soma de gastos por categoria (objeto { categoria: total })
  const gastoPorCategoria = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of txMonth) {
      if (t.amount < 0) {
        const c = t.category || "Outros";
        map[c] = (map[c] || 0) + Math.abs(t.amount);
      }
    }
    return map;
  }, [txMonth]);

  // Dados para o gráfico de pizza
  const pieData = useMemo(
    () => Object.entries(gastoPorCategoria).map(([name, value]) => ({ name, value })),
    [gastoPorCategoria]
  );

  // Tabela de orçamento do mês (para exibição: orçado, gasto, variação, status)
  const budgetRows = useMemo(() => {
    return DEFAULT_CATEGORIES.map((c) => {
      const aloc = budget[c] ?? 0; // percentual da categoria
      const orcado = receitaMes * aloc; // valor orçado = receita do mês * %
      const gasto = gastoPorCategoria[c] ?? 0;
      const cumprimento = orcado > 0 ? gasto / orcado : 0;
      // Status visual da linha para facilitar leitura
      let status: "verde" | "amarelo" | "vermelho" | "cinza" = "cinza";
      if (orcado === 0 && gasto === 0) status = "cinza";
      else if (cumprimento < 0.8) status = "verde";
      else if (cumprimento <= 1) status = "amarelo";
      else status = "vermelho";
      return { categoria: c, aloc, orcado, gasto, variancia: orcado - gasto, cumprimento, status };
    });
  }, [budget, receitaMes, gastoPorCategoria]);

  // Série diária (linha do tempo) para o LineChart
  const seriesDiaria = useMemo(() => {
    const map: Record<string, { date: string; receita: number; despesa: number }> = {};
    for (const t of txMonth) {
      const key = t.date; // agrupando por dia
      if (!map[key]) map[key] = { date: key, receita: 0, despesa: 0 };
      if (t.amount > 0) map[key].receita += t.amount;
      else map[key].despesa += Math.abs(t.amount);
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [txMonth]);

  // ------------------------------
  // Regras de categorização
  // ------------------------------
  function applyRules(toUpdate?: Tx[]) {
    // Aplica regras apenas em itens sem categoria manual
    const list = toUpdate ?? tx;
    const r = [...rules].filter((x) => x.enabled).sort((a, b) => a.priority - b.priority);

    const next = list.map((t) => {
      if (t.category) return t; // não sobrescreve se usuário já definiu
      const desc = `${t.description} ${t.account ?? ""}`.toLowerCase();
      for (const rule of r) {
        const kws = rule.keywords
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
        if (kws.some((k) => desc.includes(k))) {
          return { ...t, category: rule.category };
        }
      }
      return t;
    });
    setTx(next);
  }

  // ------------------------------
  // Importação/Exportação
  // ------------------------------
  function onImportCSV(file: File) {
    // Usa Papa.parse para ler CSV com cabeçalho flexível (date/amount/description/category)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = (res.data as any[]).filter(Boolean);
        const parsed: Tx[] = rows.map((row) => {
          // Colunas aceitas com variações de idioma/caixa
          const rawDate = row.date || row.data || row.Date || row.Data;
          const rawAmount = row.amount || row.valor || row.Amount || row.Valor;
          const rawDesc =
            row.description || row.descricao || row.Details || row.Descrição || row.Descricao || row.History;
          const rawCat = row.category || row.categoria || row.Category || row.Categoria;

          // Normaliza data suportando "yyyy-mm-dd" e "dd/mm/yyyy"
          let d: string = "";
          if (rawDate) {
            const s = String(rawDate).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = s; // já ISO
            else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
              const [dd, mm, yyyy] = s.split("/");
              d = `${yyyy}-${mm}-${dd}`; // converte para ISO
            } else {
              // Tenta deixar o JS interpretar datas como "15 Sep 2025"
              const tmp = new Date(s);
              d = isNaN(tmp.getTime()) ? new Date().toISOString().slice(0, 10) : tmp.toISOString().slice(0, 10);
            }
          } else d = new Date().toISOString().slice(0, 10);

          // Normaliza valor, considerando formatos brasileiros
          // Exemplos possíveis: "1.234,56", "723,11", "-250.30"
          let amt = 0;
          if (rawAmount !== undefined && rawAmount !== null) {
            let s = String(rawAmount).trim();
            if (s.includes(".") && s.includes(",")) {
              // 1.234,56 -> remove pontos e troca vírgula por ponto
              s = s.replace(/\./g, "").replace(",", ".");
            } else if (s.includes(",") && !s.includes(".")) {
              // 723,11 -> 723.11
              s = s.replace(",", ".");
            }
            const n = Number(s);
            amt = isNaN(n) ? 0 : n;
          }

          const desc = rawDesc ? String(rawDesc) : "(sem descrição)";
          const cat = rawCat ? String(rawCat) : undefined;

          return {
            id: uid(),
            date: d,
            amount: Number(amt),
            description: desc,
            category: cat,
            raw: row,
          };
        });

        // Faz merge com existentes e aplica regras depois (para não travar UI)
        const merged = [...tx, ...parsed];
        setTx(merged);
        setTimeout(() => applyRules(merged), 0);
      },
      error: (err) => {
        alert("Erro ao importar CSV: " + err.message);
      },
    });
  }

  // Exporta transações do app como CSV
  function onExportCSV() {
    const csv = Papa.unparse(
      tx.map((t) => ({
        date: t.date,
        amount: t.amount,
        description: t.description,
        category: t.category ?? "",
        account: t.account ?? "",
        method: t.method ?? "",
      }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacoes_${month}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Cria rapidamente uma transação manual para testes
  function addManualTx(sign: 1 | -1) {
    const d = new Date().toISOString().slice(0, 10);
    const novo: Tx = {
      id: uid(),
      date: d,
      amount: sign * 100,
      description: sign > 0 ? "Receita manual" : "Despesa manual",
      category: sign > 0 ? "Outros" : "Alimentação",
    };
    setTx([novo, ...tx]);
  }

  // Remove transação pelo id
  function removeTx(id: string) {
    setTx(tx.filter((t) => t.id !== id));
  }

  // Atualiza transação com patch parcial
  function updateTx(id: string, patch: Partial<Tx>) {
    setTx(tx.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // Seta percentual de orçamento para uma categoria (mantendo no intervalo 0..1)
  function setBudgetPct(cat: string, pct: number) {
    setBudget({ ...budget, [cat]: Math.max(0, Math.min(1, pct)) });
  }

  // Adiciona uma regra de exemplo
  function addRule() {
    const r: Rule = {
      id: uid(),
      keywords: "ifood, mcdonalds",
      category: "Alimentação",
      enabled: true,
      priority: (rules.at(-1)?.priority ?? 0) + 10,
    };
    setRules([...rules, r]);
  }

  // Gera opções de meses próximas ao mês atual para o seletor
  function monthOptionsAround(): string[] {
    const base = new Date(`${month}-01T00:00:00`);
    const list: string[] = [];
    for (let i = -6; i <= 6; i++) {
      const m = new Date(base);
      m.setMonth(base.getMonth() + i);
      list.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
    }
    // Remove duplicatas
    return Array.from(new Set(list));
  }

  // ------------------------------
  // UI
  // ------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        {/* Cabeçalho com tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <WalletCards className="w-7 h-7" />
            <h1 className="text-2xl font-bold">Financeiro Pessoal</h1>
          </div>
          <div className="flex items-center gap-2">
            {(["resumo", "transacoes", "orcamento", "regras", "config"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 rounded-2xl ${tab === t ? "bg-slate-800" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {t === "resumo" && "Resumo"}
                {t === "transacoes" && "Transações"}
                {t === "orcamento" && "Orçamento"}
                {t === "regras" && "Regras"}
                {t === "config" && (
                  <span className="inline-flex items-center gap-1">
                    <Settings className="w-4 h-4" /> Config
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Seletor de mês */}
        <div className="flex items-center gap-2 mb-6">
          <label className="text-sm opacity-80">Mês:</label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-slate-900 rounded-xl px-3 py-2"
          >
            {monthOptionsAround().map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              setMonth(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`)
            }
            className="bg-slate-900 rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <RefreshCcw className="w-4 h-4" /> Atual
          </button>
        </div>

        {/* Conteúdo por aba */}
        {tab === "resumo" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid md:grid-cols-2 gap-4">
            {/* KPIs principais */}
            <div className="bg-slate-900 rounded-2xl p-4 shadow">
              <h2 className="text-lg font-semibold mb-2">Indicadores do mês</h2>
              <div className="grid grid-cols-2 gap-3">
                <KPI title="Receita" value={formatBRL(receitaMes)} />
                <KPI title="Despesa" value={formatBRL(despesaMes)} />
                <KPI title="Resultado" value={formatBRL(resultadoMes)} highlight />
                {/* % do Orçamento consumido */}
                <KPI
                  title="% do Orçamento"
                  value={(() => {
                    const totalOrcado = Object.entries(budget).reduce(
                      (a, [_, pct]) => a + pct * receitaMes,
                      0
                    );
                    const totalGasto = Object.values(gastoPorCategoria).reduce((a, v) => a + v, 0);
                    return `${Math.round((totalOrcado ? totalGasto / totalOrcado : 0) * 100)}%`;
                  })()}
                />
              </div>
            </div>

            {/* Pizza de gastos por categoria */}
            <div className="bg-slate-900 rounded-2xl p-4 shadow">
              <h2 className="text-lg font-semibold mb-2">Gasto por categoria</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                      {pieData.map((_, idx) => (
                        <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Linha do tempo diária */}
            <div className="bg-slate-900 rounded-2xl p-4 shadow md:col-span-2">
              <h2 className="text-lg font-semibold mb-2">Linha do tempo (diário)</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={seriesDiaria}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="receita" />
                    <Line type="monotone" dataKey="despesa" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </motion.div>
        )}

        {tab === "transacoes" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Botões de ação da aba */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => addManualTx(1)}
                className="bg-emerald-600 hover:bg-emerald-700 rounded-2xl px-3 py-2 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Receita
              </button>
              <button
                onClick={() => addManualTx(-1)}
                className="bg-rose-600 hover:bg-rose-700 rounded-2xl px-3 py-2 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Despesa
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" /> Importar CSV
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files && e.target.files[0] && onImportCSV(e.target.files[0])}
              />
              <button
                onClick={onExportCSV}
                className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2 flex items-center gap-2"
              >
                <Download className="w-4 h-4" /> Exportar CSV
              </button>
            </div>

            {/* Tabela de transações do mês */}
            <div className="bg-slate-900 rounded-2xl p-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="py-2">Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th className="text-right">Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {txMonth.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 opacity-70">
                        Nenhuma transação no mês selecionado.
                      </td>
                    </tr>
                  )}
                  {txMonth
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((t) => (
                      <tr key={t.id} className="border-t border-slate-800">
                        <td className="py-2">{t.date}</td>
                        <td>
                          {/* Descrição editável: salva no onBlur para não atualizar a cada tecla */}
                          <input
                            className="bg-transparent outline-none border-b border-transparent focus:border-slate-600 w-full"
                            defaultValue={t.description}
                            onBlur={(e) => updateTx(t.id, { description: e.target.value })}
                          />
                        </td>
                        <td>
                          {/* Categoria com select simples */}
                          <select
                            className="bg-slate-800 rounded-xl px-2 py-1"
                            value={t.category || "Outros"}
                            onChange={(e) => updateTx(t.id, { category: e.target.value })}
                          >
                            {DEFAULT_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {/* Valor editável; usa <input type="number"> para aceitar negativos/positivos.
                              OBS: exibimos o número cru no input (sem R$) para evitar problemas de parsing.
                              A cor verde/vermelho é apenas visual. */}
                          <input
                            type="number"
                            step="0.01"
                            className={`bg-transparent outline-none text-right w-28 ${
                              t.amount < 0 ? "text-rose-400" : "text-emerald-400"
                            }`}
                            defaultValue={t.amount}
                            onBlur={(e) => updateTx(t.id, { amount: Number(e.target.value) })}
                          />
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => removeTx(t.id)}
                            className="p-1 rounded-lg hover:bg-slate-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {tab === "orcamento" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Tabela de orçamento por categoria */}
            <div className="bg-slate-900 rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-2">Alocação por categoria (base na receita do mês)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="text-left opacity-70">
                    <tr>
                      <th className="py-2">Categoria</th>
                      <th>%</th>
                      <th>Orçado</th>
                      <th>Gasto</th>
                      <th>Variação</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budgetRows.map((r) => (
                      <tr key={r.categoria} className="border-t border-slate-800">
                        <td className="py-2">{r.categoria}</td>
                        <td>
                          {/* Entrada em % (0..100). Armazenamos como fração (0..1). */}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            className="bg-slate-800 rounded-xl px-2 py-1 w-20 text-right"
                            value={Math.round((budget[r.categoria] ?? 0) * 100)}
                            onChange={(e) => setBudgetPct(r.categoria, Number(e.target.value) / 100)}
                          />
                        </td>
                        <td>{formatBRL(r.orcado)}</td>
                        <td>{formatBRL(r.gasto)}</td>
                        <td className={r.variancia >= 0 ? "text-emerald-400" : "text-rose-400"}>
                          {formatBRL(r.variancia)}
                        </td>
                        <td>
                          <span
                            className={`px-2 py-1 rounded-xl text-xs ${
                              r.status === "verde"
                                ? "bg-emerald-600/30 text-emerald-300"
                                : r.status === "amarelo"
                                ? "bg-amber-600/30 text-amber-300"
                                : r.status === "vermelho"
                                ? "bg-rose-600/30 text-rose-300"
                                : "bg-slate-700 text-slate-300"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Gráfico comparativo Orçado vs Gasto */}
            <div className="bg-slate-900 rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-3">Comparativo Gasto vs Orçado</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={budgetRows.map((b) => ({ categoria: b.categoria, orcado: b.orcado, gasto: b.gasto }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="categoria" interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="orcado" />
                    <Bar dataKey="gasto" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </motion.div>
        )}

        {tab === "regras" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-2">
              <button onClick={addRule} className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2">
                Nova regra
              </button>
              <button onClick={() => applyRules()} className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2">
                Aplicar regras
              </button>
            </div>
            {/* CRUD básico de regras */}
            <div className="bg-slate-900 rounded-2xl p-3 overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="py-2">Palavras‑chave (vírgula)</th>
                    <th>Categoria</th>
                    <th>Prioridade</th>
                    <th>Ativa</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 opacity-70">
                        Nenhuma regra ainda. Adicione palavras como "ifood, uber, netflix" e escolha a categoria.
                      </td>
                    </tr>
                  )}
                  {rules
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((r) => (
                      <tr key={r.id} className="border-t border-slate-800">
                        <td className="py-2">
                          <input
                            className="bg-transparent outline-none border-b border-transparent focus:border-slate-600 w-full"
                            defaultValue={r.keywords}
                            onBlur={(e) =>
                              setRules(rules.map((x) => (x.id === r.id ? { ...x, keywords: e.target.value } : x)))
                            }
                          />
                        </td>
                        <td>
                          <select
                            className="bg-slate-800 rounded-xl px-2 py-1"
                            value={r.category}
                            onChange={(e) =>
                              setRules(rules.map((x) => (x.id === r.id ? { ...x, category: e.target.value } : x)))
                            }
                          >
                            {DEFAULT_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="bg-slate-800 rounded-xl px-2 py-1 w-24"
                            value={r.priority}
                            onChange={(e) =>
                              setRules(rules.map((x) => (x.id === r.id ? { ...x, priority: Number(e.target.value) } : x)))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) =>
                              setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))
                            }
                          />
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => setRules(rules.filter((x) => x.id !== r.id))}
                            className="p-1 rounded-lg hover:bg-slate-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {tab === "config" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Limpeza/backup simples */}
            <div className="bg-slate-900 rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-2">Configurações & Backup</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    if (confirm("Isso vai limpar todas as transações. Continuar?")) setTx([]);
                  }}
                  className="bg-rose-700 hover:bg-rose-800 rounded-2xl px-3 py-2"
                >
                  Limpar transações
                </button>
                <button
                  onClick={() => {
                    if (confirm("Restaurar orçamentos padrão?")) setBudget(DEFAULT_BUDGET);
                  }}
                  className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2"
                >
                  Orçamento padrão
                </button>
                {/* Backup JSON */}
                <button
                  onClick={() => {
                    const payload = { tx, budget, rules };
                    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `backup_financeiro_${month}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2 flex items-center gap-2"
                >
                  <FileDown className="w-4 h-4" /> Baixar backup
                </button>
                {/* Restore JSON */}
                <label className="bg-slate-800 hover:bg-slate-700 rounded-2xl px-3 py-2 cursor-pointer flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Restaurar backup
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      f.text().then((txt) => {
                        try {
                          const data = JSON.parse(txt);
                          if (data.tx) setTx(data.tx);
                          if (data.budget) setBudget(data.budget);
                          if (data.rules) setRules(data.rules);
                          alert("Backup restaurado.");
                        } catch (e) {
                          alert("Arquivo inválido.");
                        }
                      });
                    }}
                  />
                </label>
              </div>
              <p className="text-xs opacity-70 mt-3">
                Seus dados ficam <b>apenas</b> neste aparelho (localStorage). Para usar em vários dispositivos,
                exporte o backup JSON e importe no outro aparelho.
              </p>
            </div>

            {/* Placeholder de integração bancária (futuro) */}
            <div className="bg-slate-900 rounded-2xl p-4">
              <h2 className="text-lg font-semibold mb-2">Integração bancária (opcional – futuro)</h2>
              <p className="opacity-80 text-sm mb-2">
                Para sincronização automática via Open Finance, você pode integrar com um agregador (Pluggy/Belvo).
                Será necessário um pequeno backend para webhooks. Este bloco é apenas um placeholder visual.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <input placeholder="API Public Key" className="bg-slate-800 rounded-xl px-3 py-2" />
                <input placeholder="Webhook Secret (server)" className="bg-slate-800 rounded-xl px-3 py-2" />
              </div>
              <div className="mt-3 flex gap-2">
                <button className="bg-slate-800 rounded-2xl px-3 py-2">Iniciar consentimento</button>
                <button className="bg-slate-800 rounded-2xl px-3 py-2">Testar importação</button>
              </div>
              <p className="text-xs opacity-70 mt-2">
                Observação: para webhooks você precisará de um backend (Cloudflare Workers/Netlify Functions) para receber
                os eventos e gravar no armazenamento.
              </p>
            </div>
          </motion.div>
        )}

        {/* Rodapé */}
        <div className="opacity-60 text-xs text-center mt-8">
          App pessoal • PWA • Adicione à Tela de Início no iPhone para usar como app.
        </div>
      </div>
    </div>
  );
}

// Componente de cartão KPI (reutilizável)
function KPI({ title, value, highlight }: { title: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${highlight ? "bg-slate-800" : "bg-slate-900"}`}>
      <div className="text-xs opacity-70">{title}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
