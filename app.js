const { useState, useEffect, useMemo } = React;

// -------------------- 定数 & ユーティリティ --------------------
const CACHE_KEY = "jobhunt-dashboard-cache-v4";
const uid = () => Math.random().toString(36).slice(2, "0");
const ymToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const cx = (...xs) => xs.filter(Boolean).join(" ");

const MAX_SHISAKU_FILE_SIZE = 500 * 1024; // 約500KB/ファイル

const formatFileSize = (bytes) => {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
};

const DEFAULT_QUOTES = [
  { text: "為せば成る。為さねば成らぬ。", author: "上杉鷹山" },
  { text: "急がば回れ。", author: "ことわざ" },
  { text: "継続は力なり。", author: "ことわざ" },
  { text: "勝って兜の緒を締めよ。", author: "ことわざ" },
  { text: "Preparation meets opportunity.", author: "Seneca" },
  { text: "Fortune favors the bold.", author: "Virgil" },
  { text: "石の上にも三年。", author: "ことわざ" },
  { text: "小さく速く、確実に。", author: "就活ダッシュボード" },
];

const DEFAULT_INDUSTRIES = [
  "総合商社",
  "コンサル",
  "金融",
  "メーカー",
  "通信・IT",
  "運輸・航空",
  "官公庁・公社",
  "メディア・エンタメ",
  "スタートアップ",
];

const migrate = (raw) => {
  const base = raw || {};
  base.strategy = base.strategy || {};
  base.strategy.vision =
    base.strategy.vision ||
    "社会にインパクトを与えるキャリアを築く。使命感・戦略性・チーム連携を重視。";
  base.strategy.focus =
    base.strategy.focus ||
    base.strategy.policies ||
    "① 情報収集 → ② 志望度上位に集中 → ③ 想定Q&A更新";
  base.strategy.routine =
    base.strategy.routine || "毎朝ニュース/週2ケース/週1振り返り";

  base.monthKey = base.monthKey || ymToday();
  base.monthlyPlans = base.monthlyPlans || { [ymToday()]: [] };
  base.monthlyGoals = base.monthlyGoals || { [ymToday()]: "" };

  base.industries = Array.isArray(base.industries)
    ? base.industries
    : DEFAULT_INDUSTRIES;

  base.companies = Array.isArray(base.companies)
    ? base.companies
    : [
        {
          id: uid(),
          name: "キーエンス",
          industry: "メーカー",
          tags: ["高収益", "直販"],
          status: "調査中",
          memo: "FA×ソフト要研究",
          links: "https://www.keyence.co.jp/",
          rating: 3,
        },
        {
          id: uid(),
          name: "ソフトバンク",
          industry: "通信・IT",
          tags: ["AI", "投資"],
          status: "調査中",
          memo: "生成AI連携/DX",
          links: "https://www.softbank.jp/",
          rating: 4,
        },
        {
          id: uid(),
          name: "内閣府",
          industry: "官公庁・公社",
          tags: ["政策"],
          status: "未着手",
          memo: "官庁訪問ルート",
          links: "https://www.cao.go.jp/",
          rating: 5,
        },
      ];

  base.quotes =
    Array.isArray(base.quotes) && base.quotes.length
      ? base.quotes
      : DEFAULT_QUOTES;

  base.filters = base.filters || { status: "", keyword: "" };

  // 思索整序用の新フィールド（既存データは空で初期化されるだけ）
  base.shisakuNote = typeof base.shisakuNote === "string" ? base.shisakuNote : "";
  base.shisakuFiles = Array.isArray(base.shisakuFiles) ? base.shisakuFiles : [];

  return base;
};

// -------------------- ルートコンポーネント --------------------
function App() {
  // ❶ ローカルキャッシュ
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return migrate(raw ? JSON.parse(raw) : null);
    } catch {
      return migrate(null);
    }
  });

  // ❷ Firebase Auth ユーザー
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);

  // UI 状態
  const [tab, setTab] = useState("strategy");
  const [selectedIndustry, setSelectedIndustry] = useState(null);

  // モーダル
  const [showIndustryModal, setShowIndustryModal] = useState(false);
  const [industryNameInput, setIndustryNameInput] = useState("");
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    name: "",
    industry: "",
    tags: "",
    links: "",
  });
  const [companyMemoOpen, setCompanyMemoOpen] = useState(false);
  const [memoCompanyId, setMemoCompanyId] = useState("");
  const [showQuotesEditor, setShowQuotesEditor] = useState(false);

  const {
    strategy,
    monthKey,
    monthlyPlans,
    monthlyGoals,
    industries,
    companies,
    quotes,
    filters,
    shisakuNote,
    shisakuFiles,
  } = data;

  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  // ---------- Firebase Auth 監視 ----------
  useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged(async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        const db = firebase.firestore();
        const ref = db.collection("users").doc(fbUser.uid);
        const snap = await ref.get();
        if (snap.exists) {
          const remote = snap.data();
          setData(migrate(remote));
        } else {
          await ref.set(data);
        }
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- ローカルストレージ保存 ----------
  useEffect(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.log("localStorage save failed", e);
    }
  }, [data]);

  // ---------- Firestore 同期（user がいる時だけ） ----------
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setSaving(true);
    const id = setTimeout(async () => {
      try {
        await firebase.firestore().collection("users").doc(user.uid).set(data);
      } catch (e) {
        console.log("Firestore save failed", e);
      } finally {
        if (!cancelled) setSaving(false);
      }
    }, 1000);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [data, user]);

  // ---------- ログイン ----------
  const handleSignIn = async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await firebase.auth().signInWithPopup(provider);
    } catch (e) {
      alert("ログインに失敗しました：" + e.message);
    }
  };
  const handleSignOut = async () => {
    try {
      await firebase.auth().signOut();
    } catch (e) {
      alert("ログアウトに失敗しました：" + e.message);
    }
  };

  // ---- 戦略
  const handleStrategyChange = (k, v) =>
    update({ strategy: { ...strategy, [k]: v } });

  // ---- 今月 ToDo / 目標（データ構造はそのまま維持）
  const ensureMonth = (ym) => {
    if (!(monthlyPlans || {})[ym])
      update({ monthlyPlans: { ...monthlyPlans, [ym]: [] } });
    if (!(monthlyGoals || {})[ym])
      update({ monthlyGoals: { ...monthlyGoals, [ym]: "" } });
  };
  const setMonth = (ym) => {
    ensureMonth(ym);
    update({ monthKey: ym });
  };
  const setMonthlyGoal = (ym, v) =>
    update({ monthlyGoals: { ...monthlyGoals, [ym]: v } });

  const addTask = () => {
    const t = { id: uid(), title: "新しいToDo", priority: "Mid", done: false };
    const list = monthlyPlans[monthKey] || [];
    update({ monthlyPlans: { ...monthlyPlans, [monthKey]: [t, ...list] } });
  };
  const updateTask = (id, patch) => {
    const list = (monthlyPlans[monthKey] || []).map((t) =>
      t.id === id ? { ...t, ...patch } : t
    );
    update({ monthlyPlans: { ...monthlyPlans, [monthKey]: list } });
  };
  const deleteTask = (id) => {
    const list = (monthlyPlans[monthKey] || []).filter((t) => t.id !== id);
    update({ monthlyPlans: { ...monthlyPlans, [monthKey]: list } });
  };

  // ---- フィルタ & ソート
  const setFilter = (k, v) => update({ filters: { ...filters, [k]: v } });

  const filteredCompanies = useMemo(() => {
    return (companies || []).filter((c) => {
      if (filters.status && c.status !== filters.status) return false;
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        const hay = [
          c.name,
          c.industry,
          c.memo,
          c.links,
          (c.tags || []).join(" "),
          c.status,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [companies, filters]);

  const [allSort, setAllSort] = useState("rating_desc");
  const allSorted = useMemo(() => {
    const list = [...(filteredCompanies || [])];
    const byName = (x, y) => x.name.localeCompare(y.name, "ja");
    const byInd = (x, y) =>
      x.industry.localeCompare(y.industry, "ja") || byName(x, y);
    const bySt = (x, y) =>
      x.status.localeCompare(y.status, "ja") || byName(x, y);
    const byRate = (x, y) => (y.rating || 0) - (x.rating || 0) || byName(x, y);
    if (allSort === "name_asc") list.sort(byName);
    else if (allSort === "industry_asc") list.sort(byInd);
    else if (allSort === "status_asc") list.sort(bySt);
    else list.sort(byRate);
    return list;
  }, [filteredCompanies, allSort]);

  const moveIndustry = (i, dir) => {
    const a = [...industries];
    const j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    update({ industries: a });
  };
  const deleteIndustry = (i) => {
    if (!confirm("この業界を削除しますか？（企業データは保持）")) return;
    const name = industries[i];
    update({ industries: industries.filter((x) => x !== name) });
  };

  // ---- 企業
  const openCompanyModal = (ind) => {
    setCompanyForm({
      name: "",
      industry: ind || industries[0] || "",
      tags: "",
      links: "",
    });
    setShowCompanyModal(true);
  };
  const submitCompany = () => {
    const nm = companyForm.name.trim();
    if (!nm) return;
    const tags = companyForm.tags.split(/[\s,]+/).filter(Boolean);
    const c = {
      id: uid(),
      name: nm,
      industry: companyForm.industry,
      tags,
      status: "未着手",
      memo: "",
      links: companyForm.links.trim(),
      rating: 0,
    };
    update({ companies: [c, ...(companies || [])] });
    setShowCompanyModal(false);
  };
  const updateCompany = (id, patch) =>
    update({
      companies: (companies || []).map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    });
  const deleteCompany = (id) => {
    if (!confirm("この企業を削除しますか？")) return;
    update({ companies: (companies || []).filter((c) => c.id !== id) });
  };
  const setRating = (id, r) => updateCompany(id, { rating: r });
  const openCompanyMemo = (id) => {
    setMemoCompanyId(id);
    setCompanyMemoOpen(true);
  };

  // ---- 思索整序：ノート
  const handleShisakuNoteChange = (v) => {
    update({ shisakuNote: v });
  };

  // ---- 思索整序：ファイル追加・削除
  const handleShisakuFilesAdd = (files) => {
    if (!files || !files.length) return;
    let tooLarge = false;

    files.forEach((file) => {
      if (file.size > MAX_SHISAKU_FILE_SIZE) {
        tooLarge = true;
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        const obj = {
          id: uid(),
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl,
        };
        setData((d) => ({
          ...d,
          shisakuFiles: [...(d.shisakuFiles || []), obj],
        }));
      };
      reader.readAsDataURL(file);
    });

    if (tooLarge) {
      alert("500KBを超えるファイルは保存できません。一部のファイルは追加されませんでした。");
    }
  };

  const handleShisakuFileDelete = (id) => {
    setData((d) => ({
      ...d,
      shisakuFiles: (d.shisakuFiles || []).filter((f) => f.id !== id),
    }));
  };

  // -------------------- UI --------------------
  return (
    <div>
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-blue-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-6 rounded bg-gradient-to-b from-blue-400 to-indigo-500" />
            <h1 className="font-extrabold text-lg">就活ダッシュボード</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {user ? (
              <>
                <span className="hidden sm:inline text-slate-600">
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt=""
                      className="inline-block w-6 h-6 rounded-full mr-1 align-middle"
                    />
                  )}
                  こんにちは、{user.displayName || user.email} さん
                </span>
                {saving && (
                  <span className="text-[10px] text-blue-600">同期中…</span>
                )}
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 border rounded-lg bg-white hover:bg-blue-50"
                >
                  ログアウト
                </button>
              </>
            ) : (
              <button
                onClick={handleSignIn}
                className="px-3 py-1.5 text-xs sm:text-sm bg-blue-600 text-white rounded-lg shadow-sm hover:opacity-90"
              >
                Googleでログイン
              </button>
            )}
          </div>
        </div>

        {/* タブ */}
        <div className="bg-white border-t border-blue-100">
          <div className="max-w-5xl mx-auto px-2 py-1 flex gap-1">
            <Tab
              label="戦略"
              active={tab === "strategy"}
              onClick={() => {
                setTab("strategy");
                setSelectedIndustry(null);
              }}
            />
            <Tab
              label="思索整序"
              active={tab === "todo"}
              onClick={() => {
                setTab("todo");
                setSelectedIndustry(null);
              }}
            />
            <Tab
              label="志望業界"
              active={tab === "companies" || tab === "industry"}
              onClick={() => {
                setTab("companies");
                setSelectedIndustry(null);
              }}
            />
            <Tab
              label="全業界横断"
              active={tab === "all"}
              onClick={() => {
                setTab("all");
                setSelectedIndustry(null);
              }}
            />
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="max-w-5xl mx-auto p-4">
        {/* 戦略 */}
        {tab === "strategy" && (
          <section className="bg-white rounded-2xl shadow-sm p-5 border border-blue-50 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">戦略目標・方針</h2>
              <span className="text-xs text-slate-500">
                自動保存（クラウド同期）
              </span>
            </div>
            <div className="relative">
              <QuoteTicker quotes={quotes} />
              <div className="absolute right-2 top-2">
                <button
                  onClick={() => setShowQuotesEditor(true)}
                  className="px-3 py-1.5 text-sm rounded-lg border bg-white hover:bg-blue-50"
                >
                  格言編集
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <div>
                <label className="text-slate-500">ビジョン</label>
                <textarea
                  rows={8}
                  value={strategy.vision}
                  onChange={(e) =>
                    handleStrategyChange("vision", e.target.value)
                  }
                  className="mt-1 w-full p-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="text-slate-500">重点方針</label>
                <textarea
                  rows={8}
                  value={strategy.focus}
                  onChange={(e) =>
                    handleStrategyChange("focus", e.target.value)
                  }
                  className="mt-1 w-full p-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="text-slate-500">ルーティーン</label>
                <textarea
                  rows={8}
                  value={strategy.routine}
                  onChange={(e) =>
                    handleStrategyChange("routine", e.target.value)
                  }
                  className="mt-1 w-full p-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
          </section>
        )}

        {/* 思索整序（旧：今月のToDo） */}
        {tab === "todo" && (
          <section className="bg-white rounded-2xl shadow-sm p-5 border border-blue-50 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h2 className="font-bold text-lg">思索整序</h2>
              <span className="text-xs text-slate-500">
                ノートとファイルはローカル & Firebase に自動保存されます
              </span>
            </div>

            {/* 思考ノート */}
            <div className="rounded-2xl border border-blue-50 bg-slate-50/70 p-4 space-y-2">
              <h3 className="font-semibold text-sm">思考ノート</h3>
              <p className="text-xs text-slate-500">
                キャリア・仕事・AI・人生についてのモヤモヤや仮説を、ざっと書き殴るためのノートです。
              </p>
              <textarea
                rows={8}
                value={shisakuNote}
                onChange={(e) => handleShisakuNoteChange(e.target.value)}
                className="w-full p-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                placeholder="例：&#10;・AI時代の“ブランド”って本当に意味あるのか？&#10;・官僚と民間のハイブリッドキャリアのイメージ&#10;・30代までに身につけたいスキルセット など"
              />
            </div>

            {/* ファイルアップロード */}
            <div className="rounded-2xl border border-blue-50 bg-slate-50/70 p-4 space-y-3">
              <h3 className="font-semibold text-sm">関連ファイルの保管</h3>
              <p className="text-xs text-slate-500">
                思考の材料になるPDF・画像・テキストなどを置いておくスペースです。選択するとすぐ保存されます。<br />
                1ファイルあたり約<strong>500KB</strong>まで推奨です（ブラウザの保存領域の制約）。
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    handleShisakuFilesAdd(
                      Array.from(e.target.files || [])
                    )
                  }
                  className="text-xs"
                />
              </div>

              <div className="mt-2">
                {(!shisakuFiles || shisakuFiles.length === 0) && (
                  <div className="text-xs text-slate-500 border border-dashed rounded-xl px-3 py-2">
                    まだ保存されているファイルはありません。
                  </div>
                )}
                {shisakuFiles && shisakuFiles.length > 0 && (
                  <ul className="space-y-2">
                    {shisakuFiles.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-2 border rounded-xl px-3 py-2 bg-white text-xs"
                      >
                        <div className="flex flex-col">
                          <span className="font-semibold">{f.name}</span>
                          <span className="text-[10px] text-slate-500">
                            {formatFileSize(f.size)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href={f.dataUrl}
                            download={f.name}
                            className="px-2 py-1 border rounded-lg bg-slate-50 hover:bg-slate-100"
                          >
                            DL
                          </a>
                          <button
                            type="button"
                            onClick={() => handleShisakuFileDelete(f.id)}
                            className="px-2 py-1 border rounded-lg"
                          >
                            削除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* 既存の「今月のToDo」ブロック（データ構造そのまま） */}
            <div className="pt-2 border-t border-dashed border-slate-200 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <h3 className="font-semibold text-sm">今月の ToDo</h3>
                <div className="flex items-center gap-2">
                  <MonthPicker value={monthKey} onChange={setMonth} />
                  <button
                    onClick={addTask}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm shadow-sm hover:opacity-90"
                  >
                    ToDo追加
                  </button>
                </div>
              </div>
              <div>
                <label className="text-slate-500 text-xs">今月の目標</label>
                <input
                  value={(monthlyGoals || {})[monthKey] || ""}
                  onChange={(e) => setMonthlyGoal(monthKey, e.target.value)}
                  placeholder="例：OB訪問4件、ケース演習10本、英語30分/日"
                  className="mt-1 w-full p-2 border rounded-xl text-sm"
                />
              </div>
              <div className="space-y-2">
                {(monthlyPlans[monthKey] || []).length === 0 && (
                  <div className="text-sm text-slate-500">
                    この月のToDoはまだありません。
                  </div>
                )}
                {(monthlyPlans[monthKey] || []).map((t) => (
                  <div
                    key={t.id}
                    className="p-3 border rounded-xl flex flex-col md:flex-row md:items-center gap-3"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="checkbox"
                        checked={t.done}
                        onChange={(e) =>
                          updateTask(t.id, { done: e.target.checked })
                        }
                      />
                      <input
                        value={t.title}
                        onChange={(e) =>
                          updateTask(t.id, { title: e.target.value })
                        }
                        className={cx(
                          "flex-1 p-2 rounded-lg border text-sm",
                          t.done && "line-through text-slate-400"
                        )}
                      />
                    </div>
                    <div className="flex items-center gap-2 text-xs md:text-sm">
                      <select
                        value={t.priority || "Mid"}
                        onChange={(e) =>
                          updateTask(t.id, { priority: e.target.value })
                        }
                        className="p-2 border rounded-lg"
                      >
                        {["Low", "Mid", "High"].map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={t.due || ""}
                        onChange={(e) =>
                          updateTask(t.id, { due: e.target.value })
                        }
                        className="p-2 border rounded-lg"
                      />
                      <input
                        placeholder="メモ"
                        value={t.note || ""}
                        onChange={(e) =>
                          updateTask(t.id, { note: e.target.value })
                        }
                        className="p-2 border rounded-lg w-40"
                      />
                      <button
                        onClick={() => deleteTask(t.id)}
                        className="px-2 py-1 border rounded-lg"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 志望業界トップ */}
        {tab === "companies" && (
          <section className="bg-white rounded-2xl shadow-sm p-5 border border-blue-50 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <h2 className="font-bold text-lg">志望業界</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTab("all")}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm"
                >
                  全業界横断ビュー
                </button>
                <button
                  onClick={() => {
                    setIndustryNameInput("");
                    setShowIndustryModal(true);
                  }}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                >
                  業界追加
                </button>
                <select
                  value={filters?.status || ""}
                  onChange={(e) => setFilter("status", e.target.value)}
                  className="p-2 border rounded-lg text-sm"
                >
                  <option value="">進捗（すべて）</option>
                  {["未着手", "調査中", "エントリー", "選考中", "内定", "辞退"].map(
                    (s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    )
                  )}
                </select>
                <input
                  value={filters?.keyword || ""}
                  onChange={(e) => setFilter("keyword", e.target.value)}
                  placeholder="キーワード"
                  className="p-2 border rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {industries.map((ind, i) => {
                const count = filteredCompanies.filter(
                  (c) => c.industry === ind
                ).length;
                return (
                  <div
                    key={ind}
                    className="border rounded-2xl p-4 hover:shadow-md transition bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <button
                        className="text-left"
                        onClick={() => {
                          setSelectedIndustry(ind);
                          setTab("industry");
                        }}
                      >
                        <h3 className="font-semibold">{ind}</h3>
                        <div className="mt-1 text-xs text-slate-500">
                          {count}社・クリックで企業一覧
                        </div>
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          title="上へ"
                          onClick={() => moveIndustry(i, -1)}
                          className="px-2 py-1 border rounded-lg"
                        >
                          ↑
                        </button>
                        <button
                          title="下へ"
                          onClick={() => moveIndustry(i, 1)}
                          className="px-2 py-1 border rounded-lg"
                        >
                          ↓
                        </button>
                        <button
                          title="削除"
                          onClick={() => deleteIndustry(i)}
                          className="px-2 py-1 border rounded-lg"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 業界別 企業一覧 */}
        {tab === "industry" && (
          <section className="bg-white rounded-2xl shadow-sm p-5 border border-blue-50 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">
                {selectedIndustry} の企業一覧
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTab("companies")}
                  className="px-3 py-1.5 border rounded-lg text-sm"
                >
                  ← 業界トップへ
                </button>
                <button
                  onClick={() => openCompanyModal(selectedIndustry || undefined)}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm"
                >
                  {selectedIndustry} に企業追加
                </button>
              </div>
            </div>
            <IndustryList
              companies={(companies || []).filter(
                (c) => c.industry === selectedIndustry
              )}
              onRate={setRating}
              onOpenMemo={openCompanyMemo}
              onDelete={deleteCompany}
            />
            {companyMemoOpen && (
              <CompanyMemoDrawer
                company={(companies || []).find(
                  (x) => x.id === memoCompanyId
                )}
                onClose={() => setCompanyMemoOpen(false)}
                onChange={(patch) => updateCompany(memoCompanyId, patch)}
                hideActionFields
              />
            )}
          </section>
        )}

        {/* 全業界横断ビュー */}
        {tab === "all" && (
          <section className="bg-white rounded-2xl shadow-sm p-5 border border-blue-50 space-y-4">
            <div className="flex 

