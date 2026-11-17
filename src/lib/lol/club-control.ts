import type {
  CareerLedger,
  Championship,
  ClubAlert,
  ClubOffer,
  ControlledClubState,
  GameId,
  Match,
  Team,
} from "./types";
import { uid } from "./generate";
import { ensureRoster, pickStarters, playerOverall } from "./players";
import { getPlayerBuyout, getPlayerSalary, getTeamBaseBudget } from "./transfers";
import { detectEliteEventType } from "./international";

function champIntlLevel(c: Championship): "none" | "minor" | "major" {
  if (c.internationalLevel === "major" || c.internationalLevel === "minor") {
    return c.internationalLevel;
  }
  if (detectEliteEventType(c.name)) return "major";
  if (c.isInternational || c.region === "Internacional") return "minor";
  return "none";
}

const SPONSORS = [
  { name: "Red Bull", mult: 1.25 },
  { name: "HyperX", mult: 1.0 },
  { name: "Logitech G", mult: 1.05 },
  { name: "Secretlab", mult: 1.1 },
  { name: "Intel", mult: 1.2 },
  { name: "Monster Energy", mult: 1.08 },
  { name: "Visa Esports", mult: 1.3 },
];

export function normClubKey(name?: string | null): string {
  return (name ?? "").trim().toLowerCase();
}

export function addClubCashDelta(
  club: ControlledClubState,
  delta: number,
  label: string,
): ControlledClubState {
  const rounded = Math.round(delta);
  const nextCash = Math.max(0, club.cash + rounded);
  const entry = {
    id: uid(),
    label,
    delta: rounded,
    at: new Date().toISOString(),
  };
  return {
    ...club,
    cash: nextCash,
    ledgerLog: [entry, ...(club.ledgerLog ?? [])].slice(0, 15),
  };
}

export function initControlledClub(
  game: GameId,
  team: Team,
  isSerieB = false,
  career?: CareerLedger,
): ControlledClubState {
  const careerEntry = career?.[game]?.[normClubKey(team.name)];
  const hasTitles = (careerEntry?.titles ?? 0) > 0;
  const baseBudget = getTeamBaseBudget(team, team.region, hasTitles, isSerieB, career, game);

  let h = 0;
  for (let i = 0; i < team.name.length; i++) h = (h * 31 + team.name.charCodeAt(i)) | 0;
  const sp = SPONSORS[Math.abs(h) % SPONSORS.length];
  const sponsorPerSplit = Math.round(baseBudget * 0.22 * sp.mult);
  const initialCash = Math.round(baseBudget * 0.35) + sponsorPerSplit;

  const now = new Date().toISOString();
  return {
    game,
    teamName: team.name,
    cash: initialCash,
    sponsorName: sp.name,
    sponsorPerSplit,
    offers: [],
    alerts: [
      {
        id: uid(),
        kind: "sponsor",
        title: `Contrato com ${sp.name}`,
        message: `Você assumiu o comando de ${team.name}. Patrocínio ativo: +$${sponsorPerSplit}k por split.`,
        createdAt: now,
      },
    ],
    ledgerLog: [
      {
        id: uid(),
        label: `Caixa inicial + Patrocínio (${sp.name})`,
        delta: initialCash,
        at: now,
      },
    ],
    claimedRewards: {},
  };
}

export function applyControlledMatchOutcome(
  ledger: CareerLedger,
  champ: Championship,
  match: Match,
  winnerId: string,
  allChampionships: Championship[],
): CareerLedger {
  const club = ledger.controlledClub;
  if (!club) return ledger;
  const game = (champ.game ?? "lol") as GameId;
  if (club.game !== game) return ledger;
  if (!match.teamAId || !match.teamBId || match.bye) return ledger;

  const pool = [...champ.teams, ...(champ.serieB?.teams ?? []), ...(champ.formerTeams ?? [])];
  const teamA = pool.find((t) => t.id === match.teamAId);
  const teamB = pool.find((t) => t.id === match.teamBId);
  if (!teamA || !teamB) return ledger;

  const clubKey = normClubKey(club.teamName);
  const isA = normClubKey(teamA.name) === clubKey;
  const isB = normClubKey(teamB.name) === clubKey;
  if (!isA && !isB) return ledger;

  const myTeam = isA ? teamA : teamB;
  const won = winnerId === myTeam.id;
  let nextClub: ControlledClubState = {
    ...club,
    offers: [...(club.offers ?? [])],
    alerts: [...(club.alerts ?? [])],
    claimedRewards: { ...(club.claimedRewards ?? {}) },
  };

  // 1. Premiação por vitória na partida
  const winKey = `w:${champ.id}:${match.id}`;
  if (won && !nextClub.claimedRewards?.[winKey]) {
    const intlLevel = champIntlLevel(champ);
    const prize = intlLevel === "major" ? 45 : intlLevel === "minor" ? 30 : 15;
    nextClub.claimedRewards![winKey] = true;
    nextClub = addClubCashDelta(
      nextClub,
      prize,
      `Vitória (${champ.name})`,
    );
  }

  const roster = ensureRoster(myTeam) ?? [];
  const starters = pickStarters(roster);
  const subs = roster.filter((p) => p.sub);
  const now = new Date().toISOString();

  // 2. Insatisfação de reserva com OVR bom sem jogar
  if (subs.length > 0 && nextClub.alerts.length < 4 && Math.random() < 0.2) {
    const unhappySub = [...subs].sort((a, b) => playerOverall(b) - playerOverall(a))[0];
    if (
      unhappySub &&
      playerOverall(unhappySub) >= 68 &&
      !nextClub.alerts.some(
        (a) => a.kind === "unhappy_bench" && normClubKey(a.playerIgn) === normClubKey(unhappySub.ign),
      )
    ) {
      nextClub.alerts.unshift({
        id: uid(),
        kind: "unhappy_bench",
        playerIgn: unhappySub.ign,
        title: `${unhappySub.ign} insatisfeito no banco`,
        message: `${unhappySub.ign} (OVR ${playerOverall(unhappySub)}) cobra espaço como titular ou pede para ser negociado.`,
        createdAt: now,
      });
    }
  }

  // 3. Cobrança do vestiário após derrota
  if (!won && starters.length > 0 && nextClub.alerts.length < 4 && Math.random() < 0.22) {
    const star = [...starters].sort((a, b) => playerOverall(b) - playerOverall(a))[0];
    if (
      star &&
      !nextClub.alerts.some(
        (a) => a.kind === "unhappy_results" && normClubKey(a.playerIgn) === normClubKey(star.ign),
      )
    ) {
      nextClub.alerts.unshift({
        id: uid(),
        kind: "unhappy_results",
        playerIgn: star.ign,
        title: `Cobrança de ${star.ign}`,
        message: `Após a derrota, ${star.ign} cobrou reação imediata e reforços para a sequência da temporada.`,
        createdAt: now,
      });
    }
  }

  // 4. Proposta de compra de outro clube por um jogador do seu elenco
  if (roster.length >= 4 && nextClub.offers.length < 3 && Math.random() < 0.18) {
    const existingOfferIgns = new Set(nextClub.offers.map((o) => normClubKey(o.playerIgn)));
    const targetCandidates = roster.filter((p) => !existingOfferIgns.has(normClubKey(p.ign)));
    if (targetCandidates.length > 0) {
      const targetPlayer =
        targetCandidates[Math.floor(Math.random() * targetCandidates.length)];
      const buyers = allChampionships
        .filter((c) => (c.game ?? "lol") === game && champIntlLevel(c) === "none")
        .flatMap((c) => c.teams)
        .filter((t) => normClubKey(t.name) !== clubKey);
      if (buyers.length > 0) {
        const buyer = buyers[Math.floor(Math.random() * buyers.length)];
        const myRating = ledger[game]?.[clubKey]?.rating ?? 50;
        const buyerRating = ledger[game]?.[normClubKey(buyer.name)]?.rating ?? 50;
        const salary = getPlayerSalary(targetPlayer, myTeam.region, ledger, game);
        const buyout = getPlayerBuyout(targetPlayer, myTeam.region, ledger, game);
        const offerAmount = Math.max(
          80,
          Math.round((salary * 0.65 + buyout) * (0.95 + Math.random() * 0.25)),
        );
        nextClub.offers.unshift({
          id: uid(),
          fromTeamName: buyer.name,
          fromTeamTag: buyer.tag,
          fromRegion: buyer.region,
          playerIgn: targetPlayer.ign,
          playerRole: targetPlayer.role,
          amount: offerAmount,
          createdAt: now,
          isBiggerClub: buyerRating >= myRating + 4,
        });
      }
    }
  }

  return {
    ...ledger,
    controlledClub: nextClub,
  };
}

export function applyControlledPlacementReward(
  ledger: CareerLedger,
  champ: Championship,
  kind: "title" | "runnerup" | "playoffs",
  teamName: string,
): CareerLedger {
  const club = ledger.controlledClub;
  if (!club) return ledger;
  const game = (champ.game ?? "lol") as GameId;
  if (club.game !== game || normClubKey(club.teamName) !== normClubKey(teamName)) {
    return ledger;
  }

  const rewardKey = `pl:${champ.id}:${champ.season ?? ""}:${kind}`;
  if (club.claimedRewards?.[rewardKey]) return ledger;

  const isElite = !!detectEliteEventType(champ.name);
  const isGlobalOpen64 = /copa global|global open|64 times|grand slam/i.test(champ.name ?? "");
  const intlLevel = champIntlLevel(champ);

  let amount = 0;
  let titleText = "";
  if (kind === "title") {
    amount = isElite ? 1200 : isGlobalOpen64 ? 900 : intlLevel === "minor" ? 650 : 450;
    titleText = `Premiação de Campeão (${champ.name})`;
  } else if (kind === "runnerup") {
    amount = isElite ? 600 : isGlobalOpen64 ? 450 : intlLevel === "minor" ? 320 : 220;
    titleText = `Premiação de Vice (${champ.name})`;
  } else {
    amount = isElite ? 280 : isGlobalOpen64 ? 220 : intlLevel === "minor" ? 180 : 120;
    titleText = `Bônus de Playoffs (${champ.name})`;
  }

  let nextClub: ControlledClubState = {
    ...club,
    claimedRewards: { ...(club.claimedRewards ?? {}), [rewardKey]: true },
    alerts: [
      {
        id: uid(),
        kind: "prize",
        title: titleText,
        message: `O clube recebeu +$${amount}k pela campanha em ${champ.name}.`,
        createdAt: new Date().toISOString(),
      },
      ...(club.alerts ?? []),
    ].slice(0, 6),
  };
  nextClub = addClubCashDelta(nextClub, amount, titleText);

  return {
    ...ledger,
    controlledClub: nextClub,
  };
}

export function applyControlledSplitSponsor(
  ledger: CareerLedger,
  game: GameId,
  splitKey: string,
): CareerLedger {
  const club = ledger.controlledClub;
  if (!club || club.game !== game) return ledger;
  const key = `sp:${game}:${splitKey}`;
  if (club.claimedRewards?.[key]) return ledger;

  const amount = club.sponsorPerSplit;
  let nextClub: ControlledClubState = {
    ...club,
    claimedRewards: { ...(club.claimedRewards ?? {}), [key]: true },
    alerts: [
      {
        id: uid(),
        kind: "sponsor",
        title: `Patrocínio ${club.sponsorName}`,
        message: `Repasse de novo split recebido: +$${amount}k no caixa do clube.`,
        createdAt: new Date().toISOString(),
      },
      ...(club.alerts ?? []),
    ].slice(0, 6),
  };
  nextClub = addClubCashDelta(nextClub, amount, `Patrocínio (${club.sponsorName})`);

  return {
    ...ledger,
    controlledClub: nextClub,
  };
}
