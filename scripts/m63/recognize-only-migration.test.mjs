import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

// Creates its own temporary local *_test DB from the repository dump + migrations
// through 050, then rolls back the fixture and drops only that DB after checking 051.
const url = process.env.TEST_DIRECT_URL;
const migration = 'db/migrations/051_srs_recognize_only.sql';
test('M6.3 removes recall/XP and rebuilds timezone activity without crediting V3 quiz', async () => {
  assert.ok(url, 'TEST_DIRECT_URL is required');
  const parsed = new URL(url);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
  assert.match(parsed.pathname, /_test$/);
  const database = `langoo_m63_${randomUUID().replaceAll('-', '')}_test`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const fixtureUrl = new URL(url);
  fixtureUrl.pathname = `/${database}`;
  const client = new pg.Client({ connectionString: fixtureUrl.toString() });
  await client.connect();
  try {
    await client.query(
      readFileSync('db/exports/langoo-min-full-inserts.sql', 'utf8'),
    );
    const applied = new Set(
      (await client.query('SELECT name FROM public.schema_migration')).rows.map(
        (r) => r.name,
      ),
    );
    for (const file of readdirSync('db/migrations')
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= 50)
      .sort()) {
      if (!applied.has(file))
        await client.query(readFileSync(`db/migrations/${file}`, 'utf8'));
    }
    await client.query('BEGIN');
    const id = randomUUID();
    const user = (
      await client.query(
        'INSERT INTO app.users(email) VALUES($1) RETURNING id',
        [`m63-${id}@langoo.test`],
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO app.user_settings(user_id,timezone,daily_goal) VALUES($1,'Pacific/Honolulu',1)",
      [user],
    );
    const profile = randomUUID(),
      collection = randomUUID(),
      item = randomUUID(),
      face = randomUUID();
    await client.query(
      "INSERT INTO app.study_profile(id,user_id,name,primary_language_id,support_language_id) VALUES($1,$2,'m63',1,3)",
      [profile, user],
    );
    await client.query(
      "INSERT INTO app.collection(id,owner_id,profile_id,name) VALUES($1,$2,$3,'m63')",
      [collection, user, profile],
    );
    await client.query(
      "INSERT INTO app.collection_item(id,collection_id,anchor_sense_id,meaning_vi) VALUES($1,$2,1,'m63')",
      [item, collection],
    );
    await client.query(
      'INSERT INTO app.collection_item_face(id,item_id,sense_id,language_id) VALUES($1,$2,1,1)',
      [face, item],
    );
    const [recognize, recall] = (
      await client.query(
        `INSERT INTO app.srs_state(face_id,user_id,profile_id,direction,introduced_at,buried_until)
      VALUES($1,$2,$3,'recognize',now(),now()+interval '1 day'),($1,$2,$3,'recall',now(),now()+interval '1 day') RETURNING id`,
        [face, user, profile],
      )
    ).rows.map((r) => r.id);
    const today = (
      await client.query(
        "SELECT (now() AT TIME ZONE 'Pacific/Honolulu')::date::text AS today",
      )
    ).rows[0].today;
    const reviewId = randomUUID();
    await client.query(
      `INSERT INTO app.review_log(srs_id,user_id,face_id,rating,reviewed_at,client_review_id)
      VALUES($1,$3,$4,3,($5::date-1+time '23:30') AT TIME ZONE 'Pacific/Honolulu',NULL),
            ($2,$3,$4,3,($5::date-2+time '23:30') AT TIME ZONE 'Pacific/Honolulu',$6),
            ($2,$3,$4,3,($5::date-4+time '23:30') AT TIME ZONE 'Pacific/Honolulu',NULL)`,
      [recognize, recall, user, face, today, reviewId],
    );
    await client.query(
      `INSERT INTO app.srs_review_receipt(user_id,client_review_id,request_payload,response_payload) VALUES
      ($1,$2,'{"direction":"recall"}','{"xp":{"amount":1}}'),
      ($1,$3,'{"direction":"recognize"}','{"xp":{"amount":3},"nested":{"xp_total":4,"kept":true,"unlocked":[{"code":"streak_7"}]}}')`,
      [user, reviewId, randomUUID()],
    );
    // Deleting a face nulls the SRS link; legacy session reviews can also lack
    // client IDs. Neither can safely prove recognize provenance after deletion.
    const orphanClientId = randomUUID();
    await client.query(
      `INSERT INTO app.review_log(srs_id,user_id,face_id,rating,reviewed_at,client_review_id)
      VALUES(NULL,$1,$2,3,($3::date-3+time '23:30') AT TIME ZONE 'Pacific/Honolulu',NULL),
            (NULL,$1,$2,3,($3::date-3+time '23:31') AT TIME ZONE 'Pacific/Honolulu',$4)`,
      [user, randomUUID(), today, orphanClientId],
    );
    await client.query(
      `INSERT INTO app.srs_review_receipt(user_id,client_review_id,request_payload,response_payload)
      VALUES($1,$2,'{"direction":"recognize"}','{"orphan":true}')`,
      [user, orphanClientId],
    );
    // Some historical receipts identify a log only in the cached response;
    // the request client ID can differ from the detached review's key.
    const orphanLog = (
      await client.query(
        'SELECT id::text FROM app.review_log WHERE user_id=$1 AND srs_id IS NULL ORDER BY reviewed_at LIMIT 1',
        [user],
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO app.srs_review_receipt(user_id,client_review_id,request_payload,response_payload) VALUES
      ($1,$2,'{"direction":"recognize"}',jsonb_build_object('review_log',jsonb_build_object('id',$4::text))),
      ($1,$3,'{"direction":"recognize"}',jsonb_build_object('version',1,'response',jsonb_build_object('review_log',jsonb_build_object('id',$4::text))))`,
      [user, randomUUID(), randomUUID(), orphanLog],
    );
    const quiz = randomUUID(),
      legacy = randomUUID(),
      v3 = randomUUID(),
      abandoned = randomUUID();
    await client.query(
      "INSERT INTO app.quiz(id,user_id,profile_id,quiz_type,difficulty,question_count) VALUES($1,$2,$3,'mixed','medium',2)",
      [quiz, user, profile],
    );
    await client.query(
      `INSERT INTO app.study_session(id,user_id,profile_id,kind,mode,quiz_id,settings) VALUES
      ($1,$4,$5,'quiz','multiple_choice',$6,'{}'),($2,$4,$5,'quiz','multiple_choice',$6,'{"quiz_version":"m11.5-v1"}'),
      ($3,$4,$5,'practice','flashcard',NULL,'{}')`,
      [legacy, v3, abandoned, user, profile, quiz],
    );
    await client.query(
      `INSERT INTO app.study_session_item(session_id,ordinal,prompt,answered_at,is_correct,answer_receipt) VALUES
      ($1,1,'{"kind":"quiz"}',($4::date-2+time '23:30') AT TIME ZONE 'Pacific/Honolulu',true,'{"response":{"xp":{"amount":5},"kept":true},"session":{"xp_awarded":5}}'),
      ($2,1,'{"kind":"quiz"}',($4::date+time '00:01') AT TIME ZONE 'Pacific/Honolulu',true,NULL),
      ($3,1,'{"direction":"recall"}',NULL,NULL,NULL)`,
      [legacy, v3, abandoned, today],
    );
    await client.query(
      "INSERT INTO app.xp_event(user_id,amount,source) VALUES($1,500,'manual')",
      [user],
    );
    await client.query(
      'INSERT INTO app.user_stats(user_id,xp_total,streak_current,streak_longest,reviews_total,items_learned) VALUES($1,500,99,99,99,99)',
      [user],
    );
    await client.query(
      'INSERT INTO app.streak_day(user_id,day,review_count,xp) VALUES($1,$2::date-4,99,500),($1,$2::date,99,0)',
      [user, today],
    );
    await client.query(
      "INSERT INTO app.user_achievement(user_id,achievement_code,progress,unlocked_at,seen_at) VALUES($1,'streak_7',99,now(),now())",
      [user],
    );
    await client.query(
      existsSync(migration) ? readFileSync(migration, 'utf8') : 'SELECT 1',
    );
    const columns = (
      await client.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='app'",
      )
    ).rows;
    assert.equal(
      columns.some(
        (r) => r.table_name === 'srs_state' && r.column_name === 'direction',
      ),
      false,
      'direction column must be removed',
    );
    assert.equal(
      columns.some((r) => /^(xp|xp_|level$)/.test(r.column_name)),
      false,
      'no XP/level columns',
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM app.srs_state WHERE face_id=$1',
          [face],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM app.review_log WHERE user_id=$1',
          [user],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM app.study_session WHERE id=$1',
          [abandoned],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM app.srs_review_receipt WHERE user_id=$1',
          [user],
        )
      ).rows[0].n,
      1,
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT response_payload FROM app.srs_review_receipt WHERE user_id=$1',
          [user],
        )
      ).rows[0].response_payload,
      { nested: { kept: true } },
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT answer_receipt FROM app.study_session_item WHERE session_id=$1',
          [legacy],
        )
      ).rows[0].answer_receipt,
      { response: { kept: true }, session: {} },
    );
    const days = (
      await client.query(
        'SELECT day::text,review_count,met_goal FROM app.streak_day WHERE user_id=$1 ORDER BY day',
        [user],
      )
    ).rows;
    assert.equal(
      days.length,
      2,
      'only quiz+recognize days survive, no recall-only/V3 day',
    );
    assert.deepEqual(
      days.map((r) => [r.review_count, r.met_goal]),
      [
        [1, true],
        [1, true],
      ],
    );
    const stats = (
      await client.query(
        'SELECT streak_current,streak_longest,reviews_total,items_learned FROM app.user_stats WHERE user_id=$1',
        [user],
      )
    ).rows[0];
    assert.deepEqual(stats, {
      streak_current: 2,
      streak_longest: 2,
      reviews_total: 1,
      items_learned: 1,
    });
    const badges = (
      await client.query(
        "SELECT to_regclass('app.achievement') a,to_regclass('app.user_achievement') ua,to_regclass('app.xp_event') xp,to_regclass('app.xp_rule') rule,to_regclass('app.leaderboard_snapshot') board",
      )
    ).rows[0];
    assert.deepEqual(badges, {
      a: null,
      ua: null,
      xp: null,
      rule: null,
      board: null,
    });
    assert.equal(
      (
        await client.query(
          'SELECT buried_until FROM app.srs_state WHERE face_id=$1',
          [face],
        )
      ).rows[0].buried_until,
      null,
    );
    await client.query('SAVEPOINT duplicate');
    await assert.rejects(
      client.query(
        'INSERT INTO app.srs_state(face_id,user_id,profile_id) VALUES($1,$2,$3)',
        [face, user, profile],
      ),
      { code: '23505' },
    );
    await client.query('ROLLBACK TO SAVEPOINT duplicate');
    console.log(
      'verified recall cascade, XP schema/JSON cleanup, timezone, legacy quiz, V3 exclusion, stats, badge removal, unique face',
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
    try {
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});
