import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfig = url && publishableKey
  ? { url: url.replace(/\/+$/, ""), publishableKey }
  : null;

export const supabase = supabaseConfig
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

let anonymousSignInPromise = null;
const ACTION_QUEUE_KEY = "life_rpg_action_queue";

function readActionQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTION_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (error) {
    console.warn("ACTION再送キューが壊れていたため初期化しました。", error);
    localStorage.removeItem(ACTION_QUEUE_KEY);
    return [];
  }
}

async function getUser() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user) return data.session.user;

  anonymousSignInPromise ||= supabase.auth.signInAnonymously();
  const result = await anonymousSignInPromise;
  anonymousSignInPromise = null;
  if (result.error) throw result.error;
  return result.data.user;
}

function publicProfileRow(state, userId) {
  const social = state.social || {};
  const privacy = social.privacy || {};
  return {
    id: userId,
    username: state.profile.username,
    display_name: privacy.showRealName ? state.profile.name : state.profile.username || "PLAYER",
    age: privacy.showAge ? Number(state.profile.age) || null : null,
    real_name: privacy.showRealName ? state.profile.name : null,
    public_profile: Boolean(privacy.publicProfile),
    show_age: Boolean(privacy.showAge),
    show_real_name: Boolean(privacy.showRealName),
    show_stats: Boolean(privacy.showStats),
    show_achievements: Boolean(privacy.showAchievements),
    level: state.level || 1,
    exp: state.exp || 0,
    job_level: state.jobLevel || 1,
    job_name: state.job?.name || "未設定",
    job_icon: state.job?.icon || "A",
    guild_level: social.guild?.level || 0,
    stats: privacy.showStats ? state.stats || {} : {},
    achievements: privacy.showAchievements ? Object.keys(state.completedQuests || {}).length : 0,
    total_actions: state.totalActions || 0,
    updated_at: new Date().toISOString(),
  };
}

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || "PLAYER",
    realName: row.real_name || "",
    age: row.age || "",
    level: row.level || 1,
    exp: row.exp || 0,
    jobLevel: row.job_level || 1,
    guildLevel: row.guild_level || 0,
    job: row.job_name || "未設定",
    icon: row.job_icon || "A",
    stats: row.show_stats ? row.stats || {} : {},
    achievements: row.show_achievements ? row.achievements || 0 : 0,
    periodExp: row.period_exp || 0,
    periodActions: row.period_actions || 0,
    remote: true,
  };
}

export async function getAuthStatus() {
  if (!supabase) return { configured: false, authenticated: false, anonymous: false, email: null };
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const user = data.session?.user || null;
  return {
    configured: true,
    authenticated: Boolean(user),
    anonymous: Boolean(user?.is_anonymous),
    email: user?.email || null,
  };
}

export async function linkAccount(provider) {
  if (!supabase) throw new Error("Supabaseが設定されていません。");
  const user = await getUser();
  if (!user) throw new Error("Supabaseユーザーセッションがありません。");
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

export async function deleteAccount() {
  if (!supabase) throw new Error("Supabaseが設定されていません。");
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await supabase.auth.signOut();
}

function privateGameState(state) {
  return {
    schemaVersion: state.schemaVersion || 1,
    initialized: Boolean(state.initialized),
    profile: state.profile,
    stats: state.stats,
    job: state.job,
    diagnosisScores: state.diagnosisScores,
    level: state.level,
    exp: state.exp,
    jobExp: state.jobExp,
    jobLevel: state.jobLevel,
    dailyActionCount: state.dailyActionCount,
    dailyActionDate: state.dailyActionDate,
    actionCounts: state.actionCounts,
    actionHistory: state.actionHistory,
    actionLog: state.actionLog,
    actionPerformance: state.actionPerformance,
    customActions: state.customActions,
    completedQuests: state.completedQuests,
    streak: state.streak,
    lastActionDate: state.lastActionDate,
    createdAt: state.createdAt,
    // AURUM・アイテム・装備・ガチャはどれも「獲得物」として同じ懸念事項のため
    // まとめて同期する。再ログイン後に装備やチケットが消える不具合を防ぐ。
    currency: state.currency,
    inventory: state.inventory,
    ownedEquipment: state.ownedEquipment,
    discoveredItems: state.discoveredItems,
    equipment: state.equipment,
    gachaTickets: state.gachaTickets,
    gachaHistory: state.gachaHistory,
  };
}

export async function loadGameState() {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("game_states")
    .select("state,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? { state: data.state, updatedAt: data.updated_at } : null;
}

export async function isUsernameAvailable(username, currentUserId = null) {
  if (!supabase || !username?.trim()) return true;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username.trim())
    .maybeSingle();
  if (error) {
    // 疎通確認に失敗した場合はブロックせず、実際の保存時のユニーク制約に委ねる。
    console.warn("USERNAME重複チェックに失敗しました。", error);
    return true;
  }
  return !data || data.id === currentUserId;
}

export async function syncLifeRpgState(state) {
  if (!supabase) return { synced: false, reason: "Supabase環境変数が未設定です。" };
  if (!state?.profile?.username) return { synced: false, reason: "USERNAMEが未設定です。" };
  const user = await getUser();
  if (!user) throw new Error("Supabase user session was not created.");

  // ゲーム本体データ（LEVEL/EXP/STATS/JOB等）とSOCIAL公開プロフィールの保存は
  // 独立した懸念事項として扱う。ユーザー名の重複などプロフィール側の問題で
  // ゲームデータそのものの永続化まで失敗扱いにしないための分離。
  const [{ error: profileError }, { error: stateError }] = await Promise.all([
    supabase.from("profiles").upsert(publicProfileRow(state, user.id)),
    supabase.from("game_states").upsert({ user_id: user.id, state: privateGameState(state), updated_at: new Date().toISOString() }),
  ]);
  if (stateError) throw stateError;
  if (profileError) {
    const usernameTaken = profileError.code === "23505";
    console.warn("公開プロフィールの同期に失敗しました。ゲームデータの保存は継続します。", profileError);
    return {
      synced: true,
      userId: user.id,
      profileSynced: false,
      profileErrorReason: usernameTaken ? "username_taken" : "profile_error",
    };
  }
  return { synced: true, userId: user.id, profileSynced: true };
}

function sharedProgressPayload(state, updateEquipment) {
  const equipment = state.equipment || {};
  return {
    p_level: Math.min(10000, Math.max(1, Math.floor(Number(state.level) || 1))),
    p_exp: Math.min(1000000, Math.max(0, Math.floor(Number(state.exp) || 0))),
    p_owned_equipment: Array.isArray(state.ownedEquipment) ? state.ownedEquipment : [],
    p_equipment: updateEquipment ? {
      weapon: equipment.weapon || null,
      armor: equipment.armor || null,
      accessory: equipment.accessory || null,
    } : null,
    p_update_equipment: updateEquipment,
  };
}

export async function createOpenWorldPairingBundle() {
  if (!supabase || !supabaseConfig) throw new Error("Supabaseが設定されていません。");
  await getUser();
  const { data, error } = await supabase.rpc("create_open_world_pairing");
  if (error) throw error;
  if (!data?.code || !data?.expires_at) throw new Error("ペアリングコードを作成できませんでした。");
  return JSON.stringify({
    version: 1,
    url: supabaseConfig.url,
    publishableKey: supabaseConfig.publishableKey,
    code: data.code,
    expiresAt: data.expires_at,
  });
}

export async function loadOpenWorldProgress() {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("open_world_progress")
    .select("level,exp,owned_equipment,equipment,equipment_updated_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? {
    level: data.level,
    exp: data.exp,
    ownedEquipment: data.owned_equipment,
    equipment: data.equipment,
    equipmentUpdatedAt: data.equipment_updated_at,
    updatedAt: data.updated_at,
  } : null;
}

export async function saveOpenWorldProgress(state, updateEquipment = true) {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("save_my_open_world_progress", sharedProgressPayload(state, updateEquipment));
  if (error) throw error;
  return data;
}

export async function loadSocialData() {
  if (!supabase) return null;
  const user = await getUser();
  if (!user) return null;

  const results = await Promise.allSettled([
    supabase.from("friend_requests").select("id,requester_id,addressee_id,status,created_at").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).order("created_at", { ascending: false }),
    supabase.from("friendships").select("user_low,user_high").or(`user_low.eq.${user.id},user_high.eq.${user.id}`),
    supabase.from("guild_members").select("guild_id, user_id, role, contribution").eq("user_id", user.id),
    supabase.from("guilds").select("id,owner_id,name,tag,description,icon,level,exp,total_level,quest_progress").order("created_at", { ascending: false }),
    supabase.from("life_rpg_public_ranking").select("id,username,display_name,level,exp,job_level,job_name,job_icon,guild_level,achievements,total_actions").order("level", { ascending: false }).limit(100),
    supabase.from("life_rpg_weekly_ranking").select("id,username,display_name,level,exp,job_level,job_name,job_icon,guild_level,achievements,total_actions,period_exp,period_actions").order("period_exp", { ascending: false }).limit(100),
    supabase.from("life_rpg_monthly_ranking").select("id,username,display_name,level,exp,job_level,job_name,job_icon,guild_level,achievements,total_actions,period_exp,period_actions").order("period_exp", { ascending: false }).limit(100),
    supabase.from("messages").select("id,sender_id,created_at").eq("recipient_id", user.id).is("read_at", null),
  ]);
  const readResult = (index, label) => {
    const result = results[index];
    if (result.status === "fulfilled") {
      if (result.value.error) console.warn(`${label}の読み込みに失敗しました。`, result.value.error);
      return result.value.data || [];
    }
    console.warn(`${label}の読み込みに失敗しました。`, result.reason);
    return [];
  };
  const requests = readResult(0, "フレンド申請");
  const friendships = readResult(1, "フレンド");
  const guildMemberships = readResult(2, "GUILDメンバー");
  const guilds = readResult(3, "GUILD");
  const rankings = readResult(4, "ランキング");
  const weeklyRanking = readResult(5, "週間ランキング");
  const monthlyRanking = readResult(6, "月間ランキング");
  const unreadMessages = readResult(7, "メッセージ");

  const friendIds = (friendships || []).map((row) => row.user_low === user.id ? row.user_high : row.user_low);
  const requestUserIds = (requests || []).flatMap((row) => [row.requester_id, row.addressee_id]).filter((id) => id !== user.id);
  const memberGuildIds = (guildMemberships || []).map((row) => row.guild_id);
  const guildRows = (guilds || []).filter((guild) => memberGuildIds.includes(guild.id));
  const guildIds = [...new Set([...memberGuildIds, ...guildRows.map((guild) => guild.id)])];
  const guildMemberQuery = guildIds.length
    ? supabase.from("guild_members").select("guild_id,user_id,role,contribution").in("guild_id", guildIds)
    : Promise.resolve({ data: [], error: null });
  const profileIds = [...new Set([...friendIds, ...requestUserIds, ...(rankings || []).map((row) => row.id).filter((id) => id !== user.id)])];
  const { data: memberRows, error: guildMemberError } = await guildMemberQuery;
  if (guildMemberError) console.warn("GUILDメンバーの読み込みに失敗しました。", guildMemberError);
  profileIds.push(...(memberRows || []).map((row) => row.user_id));
  const uniqueProfileIds = [...new Set(profileIds)];
  const { data: profiles, error: profileError } = uniqueProfileIds.length
    ? await supabase.from("profiles").select("id,username,display_name,real_name,age,public_profile,show_age,show_real_name,show_stats,show_achievements,level,exp,job_level,job_name,job_icon,guild_level,stats,achievements,total_actions").in("id", uniqueProfileIds)
    : { data: [], error: null };
  if (profileError) console.warn("フレンドプロフィールの読み込みに失敗しました。", profileError);
  const users = (profiles || []).map((row) => toUser({
    ...row,
    real_name: row.show_real_name ? row.real_name : null,
    age: row.show_age ? row.age : null,
    stats: row.show_stats ? row.stats : {},
    achievements: row.show_achievements ? row.achievements : 0,
  }));
  const byId = new Map(users.map((item) => [item.id, item]));
  const ownGuildRow = guildRows[0] || null;
  const ownGuildMembers = ownGuildRow ? (memberRows || []).filter((row) => row.guild_id === ownGuildRow.id) : [];
  const guild = ownGuildRow ? {
    id: ownGuildRow.id,
    name: ownGuildRow.name,
    tag: ownGuildRow.tag,
    description: ownGuildRow.description || "",
    icon: ownGuildRow.icon || "✦",
    level: ownGuildRow.level || 1,
    exp: ownGuildRow.exp || 0,
    totalLevel: ownGuildRow.total_level || 0,
    rank: null,
    contribution: ownGuildMembers.find((row) => row.user_id === user.id)?.contribution || 0,
    questProgress: ownGuildRow.quest_progress || 0,
    memberIds: ownGuildMembers.map((row) => row.user_id === user.id ? "self" : row.user_id),
    remote: true,
    isOwner: ownGuildRow.owner_id === user.id,
  } : null;
  const remoteGuilds = (guilds || []).map((item) => ({
    id: item.id,
    name: item.name,
    tag: item.tag,
    description: item.description || "",
    icon: item.icon || "✦",
    level: item.level || 1,
    exp: item.exp || 0,
    totalLevel: item.total_level || 0,
    rank: null,
    contribution: 0,
    questProgress: item.quest_progress || 0,
    memberIds: [],
    remote: true,
  }));
  return {
    userId: user.id,
    users,
    friends: friendIds,
    friendRequests: (requests || []).filter((row) => row.status === "pending").map((row) => ({
      id: row.id,
      userId: row.requester_id === user.id ? row.addressee_id : row.requester_id,
      direction: row.requester_id === user.id ? "outgoing" : "incoming",
      status: row.status,
      createdAt: row.created_at,
      user: byId.get(row.requester_id === user.id ? row.addressee_id : row.requester_id),
    })),
    guild,
    guilds: remoteGuilds,
    ranking: (rankings || []).filter((row) => row.id !== user.id).map(toUser),
    weeklyRanking: weeklyRanking.map(toUser),
    monthlyRanking: monthlyRanking.map(toUser),
    messagesAvailable: true,
    unreadMessages: (unreadMessages || []).reduce((counts, row) => ({ ...counts, [row.sender_id]: (counts[row.sender_id] || 0) + 1 }), {}),
  };
}

export async function searchPublicProfiles(query) {
  if (!supabase) return [];
  const user = await getUser();
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const idQuery = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(term);
  const safeTerm = term.replace(/[%,()]/g, "");
  let request = supabase.from("profiles").select("id,username,display_name,real_name,age,public_profile,show_age,show_real_name,show_stats,show_achievements,level,exp,job_level,job_name,job_icon,guild_level,stats,achievements,total_actions").eq("public_profile", true).neq("id", user.id);
  request = idQuery
    ? request.or(`username.ilike.%${safeTerm}%,display_name.ilike.%${safeTerm}%,id.eq.${term}`)
    : request.or(`username.ilike.%${safeTerm}%,display_name.ilike.%${safeTerm}%`);
  const { data, error } = await request.limit(30);
  if (error) throw error;
  return (data || []).map((row) => toUser({
    ...row,
    real_name: row.show_real_name ? row.real_name : null,
    age: row.show_age ? row.age : null,
    stats: row.show_stats ? row.stats : {},
    achievements: row.show_achievements ? row.achievements : 0,
  }));
}

export async function sendFriendRequest(addresseeId) {
  if (!supabase) return null;
  const user = await getUser();
  const { data: existing, error: existingError } = await supabase
    .from("friend_requests")
    .select("id,requester_id,addressee_id,status,created_at")
    .eq("status", "pending")
    .or(`and(requester_id.eq.${user.id},addressee_id.eq.${addresseeId}),and(requester_id.eq.${addresseeId},addressee_id.eq.${user.id})`)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { ...existing, alreadyPending: true };
  const { data, error } = await supabase.from("friend_requests").insert({ requester_id: user.id, addressee_id: addresseeId }).select("id,requester_id,addressee_id,status,created_at").single();
  if (error) throw error;
  return data;
}

export async function respondToFriendRequest(requestId, accepted) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("friend_requests").update({ status: accepted ? "accepted" : "declined", responded_at: new Date().toISOString() }).eq("id", requestId).select("id,status").single();
  if (error) throw error;
  return data;
}

export async function removeFriend(friendId) {
  if (!supabase) return null;
  const user = await getUser();
  const low = [user.id, friendId].sort()[0];
  const high = [user.id, friendId].sort()[1];
  const { error } = await supabase.from("friendships").delete().eq("user_low", low).eq("user_high", high);
  if (error) throw error;
  return { removed: true };
}

function toMessage(row, userId) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    isMine: row.sender_id === userId,
  };
}

export async function loadConversation(friendId) {
  if (!supabase) return null;
  const user = await getUser();
  if (!user || !friendId) return [];
  const { data, error } = await supabase
    .from("messages")
    .select("id,sender_id,recipient_id,body,created_at,read_at")
    .or(`and(sender_id.eq.${user.id},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${user.id})`)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;

  const unreadIds = (data || [])
    .filter((row) => row.recipient_id === user.id && !row.read_at)
    .map((row) => row.id);
  if (unreadIds.length) {
    const { error: readError } = await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds)
      .eq("recipient_id", user.id);
    if (readError) throw readError;
  }
  const readAt = unreadIds.length ? new Date().toISOString() : null;
  return (data || []).map((row) => toMessage(
    unreadIds.includes(row.id) ? { ...row, read_at: readAt } : row,
    user.id,
  ));
}

export async function sendMessage(recipientId, body) {
  if (!supabase) return null;
  const user = await getUser();
  const text = String(body || "").trim();
  if (!user || !recipientId || !text) return null;
  const { data, error } = await supabase
    .from("messages")
    .insert({ sender_id: user.id, recipient_id: recipientId, body: text })
    .select("id,sender_id,recipient_id,body,created_at,read_at")
    .single();
  if (error) throw error;
  return toMessage(data, user.id);
}

export async function createGuild(input) {
  if (!supabase) return null;
  const user = await getUser();
  const { data: guild, error } = await supabase.from("guilds").insert({
    owner_id: user.id,
    name: input.name,
    tag: input.tag,
    description: input.description || "",
    icon: input.icon || "✦",
  }).select("id,owner_id,name,tag,description,icon,level,exp,total_level,quest_progress").single();
  if (error) throw error;
  const { error: memberError } = await supabase.from("guild_members").insert({ guild_id: guild.id, user_id: user.id, role: "owner" });
  if (memberError) throw memberError;
  return {
    id: guild.id, name: guild.name, tag: guild.tag, description: guild.description, icon: guild.icon,
    level: guild.level, exp: guild.exp, totalLevel: guild.total_level, rank: null, contribution: 0,
    questProgress: guild.quest_progress, memberIds: ["self"], remote: true, isOwner: true,
  };
}

export async function updateGuildIcon(guildId, icon) {
  if (!supabase) return null;
  const { error } = await supabase.from("guilds").update({ icon }).eq("id", guildId);
  if (error) throw error;
  return { icon };
}

export async function joinGuild(guildId) {
  if (!supabase) return null;
  const user = await getUser();
  const { error } = await supabase.from("guild_members").insert({ guild_id: guildId, user_id: user.id, role: "member" });
  if (error) throw error;
  return { joined: true };
}

export async function recordActionContribution(action, guildId) {
  if (!supabase) return null;
  const eventId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `action-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    eventId,
    guildId: guildId || null,
    actionId: action.id,
    exp: action.exp || 0,
    statEffects: action.effects || {},
    target: action.target || null,
    unit: action.unit || null,
    estimatedTime: action.estimatedTime || null,
    actualValue: action.actualValue || null,
    actualTime: action.actualTime || null,
    result: action.completionFactor < .99 ? "partial" : "completed",
    createdAt: new Date().toISOString(),
  };
  try {
    const user = await getUser();
    const { error } = await supabase.from("action_events").insert({
      id: payload.eventId,
      user_id: user.id,
      guild_id: payload.guildId,
      action_id: payload.actionId,
      exp: payload.exp,
      stat_effects: payload.statEffects,
      target: payload.target,
      unit: payload.unit,
      estimated_time: payload.estimatedTime,
      actual_value: payload.actualValue,
      actual_time: payload.actualTime,
      result: payload.result,
      created_at: payload.createdAt,
    });
    if (error) throw error;
    return { recorded: true };
  } catch (error) {
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    const networkFailure = error instanceof TypeError;
    if (!offline && !networkFailure) throw error;
    const queued = readActionQueue();
    localStorage.setItem(ACTION_QUEUE_KEY, JSON.stringify([...queued, payload].slice(-100)));
    return { recorded: false, queued: true, error };
  }
}

export async function flushQueuedActionContributions() {
  if (!supabase) return { flushed: 0, remaining: 0 };
  const queued = readActionQueue();
  if (!queued.length) return { flushed: 0, remaining: 0 };
  const user = await getUser();
  let flushed = 0;
  for (const payload of queued) {
    const eventId = payload.eventId || (typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `action-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const { error } = await supabase.from("action_events").insert({
      id: eventId,
      user_id: user.id,
      guild_id: payload.guildId,
      action_id: payload.actionId,
      exp: payload.exp,
      stat_effects: payload.statEffects,
      target: payload.target,
      unit: payload.unit,
      estimated_time: payload.estimatedTime,
      actual_value: payload.actualValue,
      actual_time: payload.actualTime,
      result: payload.result,
      created_at: payload.createdAt,
    });
    if (error && error.code !== "23505") break;
    flushed += 1;
  }

  const remaining = queued.slice(flushed);
  localStorage.setItem(ACTION_QUEUE_KEY, JSON.stringify(remaining));
  return { flushed, remaining: remaining.length };
}

export async function openCoopBattleChannel(roomCode, handlers = {}) {
  if (!supabase) throw new Error("Supabaseが設定されていません。");
  const code = String(roomCode || "").trim().toUpperCase();
  if (!/^[0-9]{6}$/.test(code)) throw new Error("ルームコードは6桁の数字で入力してください。");
  const user = await getUser();
  if (!user) throw new Error("Supabaseユーザーセッションがありません。");
  const channel = supabase.channel(`coop-battle:${code}`, {
    config: { broadcast: { self: false }, presence: { key: user.id } },
  });
  channel.on("broadcast", { event: "coop-message" }, ({ payload }) => {
    if (payload?.senderId !== user.id) handlers.onMessage?.(payload);
  });
  channel.on("presence", { event: "sync" }, () => handlers.onPresence?.(channel.presenceState()));
  channel.on("presence", { event: "join" }, () => handlers.onPresence?.(channel.presenceState()));
  channel.on("presence", { event: "leave" }, () => handlers.onPresence?.(channel.presenceState()));
  await new Promise((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(error || new Error(`Realtime status: ${status}`));
    });
  });
  await channel.track({ userId: user.id, joinedAt: new Date().toISOString() });
  return { channel, userId: user.id };
}

export async function sendCoopBattleMessage(channel, type, payload = {}) {
  if (!channel) return;
  await channel.send({ type: "broadcast", event: "coop-message", payload: { type, ...payload } });
}

export async function closeCoopBattleChannel(channel) {
  if (channel && supabase) await supabase.removeChannel(channel);
}
