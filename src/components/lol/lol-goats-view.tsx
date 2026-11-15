import { Crown, Flame, Medal, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import type { CareerLedger, Championship, PlayerRole, Team } from "@/lib/lol/types";
import { computeLoLGoats } from "@/lib/lol/goats";
import { TeamLogo } from "./team-logo";
import { PlayerAvatar } from "./player-avatar";
import { CountryFlag } from "./country-flag";

const ROLE_LABEL: Record<PlayerRole, string> = {
  top: "TOP",
  jungle: "JG",
  mid: "MID",
  adc: "ADC",
  support: "SUP",
};

interface LolGoatsViewProps {
  career: CareerLedger;
  championships: Championship[];
  onSelectTeam: (team: Team) => void;
}

export function LolGoatsView({ career, championships, onSelectTeam }: LolGoatsViewProps) {
  const { teamGoats, playerGoats } = computeLoLGoats(career, championships);

  return (
    <div className="space-y-12">
      {/* Regras de Ouro Anti-Poluição */}
      <div className="border-2 border-gold/50 bg-gradient-to-r from-gold/10 via-card to-blood/10 p-5 shadow-[6px_6px_0_0_var(--gold)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-gold" />
              <h2 className="font-display text-2xl uppercase tracking-widest text-gold">
                Panteão dos GOATs · Lendas Históricas do LoL
              </h2>
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Apenas a elite absoluta da história do League of Legends entra aqui. Ligas domésticas
              (CBLOL, LCK, LPL, LEC, LCS, LCP) <strong className="text-bone">não contam</strong> — apenas
              campanhas <strong className="text-gold">internacionais</strong> (Worlds, MSI e torneios globais)
              com <strong className="text-bone">dominância prolongada em 2+ temporadas distintas</strong>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest">
            <span className="inline-flex items-center gap-1 border border-gold/40 bg-black/40 px-2.5 py-1 text-gold">
              <ShieldCheck className="h-3.5 w-3.5" /> Só Internacional
            </span>
            <span className="inline-flex items-center gap-1 border border-amber-400/40 bg-black/40 px-2.5 py-1 text-amber-300">
              <Flame className="h-3.5 w-3.5" /> 2+ Anos no Topo
            </span>
            <span className="inline-flex items-center gap-1 border border-blood/50 bg-black/40 px-2.5 py-1 text-bone">
              Top 8 Times · Top 10 Players
            </span>
          </div>
        </div>
      </div>

      {/* SEÇÃO 1: TIMES GOAT */}
      <section>
        <div className="mb-5 flex items-center justify-between border-b-2 border-gold/30 pb-2">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-gold" />
            <div>
              <h3 className="font-display text-2xl uppercase tracking-widest text-gold">
                Times GOAT ({teamGoats.length}/8)
              </h3>
              <p className="text-xs text-muted-foreground">
                Dinastias que conquistaram múltiplos títulos internacionais ou dominaram Worlds/MSI por várias temporadas.
              </p>
            </div>
          </div>
        </div>

        {teamGoats.length === 0 ? (
          <div className="border-2 border-dashed border-gold/30 bg-card/50 p-8 text-center">
            <Crown className="mx-auto mb-2 h-8 w-8 text-gold/50" />
            <p className="font-display text-lg uppercase tracking-wider text-bone">
              Nenhuma dinastia atingiu o nível GOAT ainda
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
              Para evitar poluição, um time só entra aqui após dominar torneios internacionais
              em <strong>2 ou mais temporadas distintas</strong> (ex.: 2+ títulos de Worlds/MSI, ou 1 Major + múltiplos títulos/finais internacionais).
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {teamGoats.map((t) => {
              const isTop1 = t.rank === 1;
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() =>
                    onSelectTeam({
                      id: `career:${t.name.toLowerCase()}`,
                      name: t.name,
                      tag: t.tag ?? "",
                      logo: t.logo,
                      region: t.region,
                    })
                  }
                  className={`group flex items-center justify-between gap-4 border-2 p-4 text-left transition-all hover:border-gold ${
                    isTop1
                      ? "border-gold bg-gradient-to-r from-gold/15 via-card to-card shadow-[6px_6px_0_0_var(--gold)]"
                      : "border-ink bg-card shadow-[4px_4px_0_0_rgba(0,0,0,0.6)] hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center font-display text-xl font-bold ${
                        isTop1
                          ? "bg-gold text-ink"
                          : t.rank <= 3
                            ? "border border-gold/60 bg-gold/15 text-gold"
                            : "border border-border bg-black/40 text-muted-foreground"
                      }`}
                    >
                      #{t.rank}
                    </div>
                    <TeamLogo
                      team={{
                        id: t.name,
                        name: t.name,
                        tag: t.tag ?? "",
                        logo: t.logo,
                        region: t.region,
                      }}
                      size={40}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-xl uppercase tracking-wider text-bone group-hover:text-gold transition-colors">
                          {t.name}
                        </span>
                        {t.region ? (
                          <span className="border border-border/60 bg-black/40 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                            {t.region}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {t.worldsTitles > 0 && (
                          <span className="font-bold text-gold">🏆 {t.worldsTitles}x Worlds</span>
                        )}
                        {t.msiTitles > 0 && (
                          <span className="font-bold text-amber-300">👑 {t.msiTitles}x MSI</span>
                        )}
                        {t.minorIntlTitles > 0 && (
                          <span className="text-cyan-300">🌐 {t.minorIntlTitles}x Int.</span>
                        )}
                        {t.majorFinals > 0 && (
                          <span>🥈 {t.majorFinals}x Final Major</span>
                        )}
                        <span className="text-muted-foreground/80">· Era {t.eraLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      GOAT
                    </div>
                    <div className="font-display text-2xl text-gold">{t.goatScore}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* SEÇÃO 2: JOGADORES GOAT */}
      <section>
        <div className="mb-5 flex items-center justify-between border-b-2 border-gold/30 pb-2">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-gold" />
            <div>
              <h3 className="font-display text-2xl uppercase tracking-widest text-gold">
                Jogadores GOAT ({playerGoats.length}/10)
              </h3>
              <p className="text-xs text-muted-foreground">
                Ícones individuais com títulos, finais e MVPs internacionais sustentados ao longo de múltiplas temporadas.
              </p>
            </div>
          </div>
        </div>

        {playerGoats.length === 0 ? (
          <div className="border-2 border-dashed border-gold/30 bg-card/50 p-8 text-center">
            <Medal className="mx-auto mb-2 h-8 w-8 text-gold/50" />
            <p className="font-display text-lg uppercase tracking-wider text-bone">
              Nenhum jogador atingiu o panteão GOAT ainda
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
              Jogadores só entram aqui após acumular títulos, finais e MVPs em torneios
              internacionais ao longo de <strong>2 ou mais temporadas distintas</strong>. Ligas regionais nunca contam.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {playerGoats.map((p) => {
              const isTop1 = p.rank === 1;
              return (
                <div
                  key={p.ign}
                  className={`flex items-center justify-between gap-4 border-2 p-4 ${
                    isTop1
                      ? "border-gold bg-gradient-to-r from-gold/15 via-card to-card shadow-[6px_6px_0_0_var(--gold)]"
                      : "border-ink bg-card shadow-[4px_4px_0_0_rgba(0,0,0,0.6)]"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center font-display text-xl font-bold ${
                        isTop1
                          ? "bg-gold text-ink"
                          : p.rank <= 3
                            ? "border border-gold/60 bg-gold/15 text-gold"
                            : "border border-border bg-black/40 text-muted-foreground"
                      }`}
                    >
                      #{p.rank}
                    </div>
                    <PlayerAvatar
                      name={p.ign}
                      real={p.real}
                      role={p.role}
                      game="lol"
                      size={44}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-display text-xl uppercase tracking-wider text-bone">
                          {p.ign}
                        </span>
                        {p.country ? <CountryFlag code={p.country} size={14} /> : null}
                        <span className="border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gold">
                          {ROLE_LABEL[p.role]}
                        </span>
                        {p.retired ? (
                          <span className="border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300">
                            Aposentado
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {p.teamTag ? `${p.teamTag} · ` : ""}
                        {p.teamName} · <span className="text-bone/80">Era {p.eraLabel}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {p.worldsTitles > 0 && (
                          <span className="font-bold text-gold">🏆 {p.worldsTitles}x Worlds</span>
                        )}
                        {p.msiTitles > 0 && (
                          <span className="font-bold text-amber-300">👑 {p.msiTitles}x MSI</span>
                        )}
                        {p.minorIntlTitles > 0 && (
                          <span className="text-cyan-300">🌐 {p.minorIntlTitles}x Int.</span>
                        )}
                        {p.intlMvps > 0 && (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-400">
                            <Sparkles className="h-3 w-3" /> {p.intlMvps}x MVP Int.
                          </span>
                        )}
                        {p.majorFinals > 0 && (
                          <span>🥈 {p.majorFinals}x Final Major</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      GOAT
                    </div>
                    <div className="font-display text-2xl text-gold">{p.goatScore}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
