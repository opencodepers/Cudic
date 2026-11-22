import json
import os
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE = r"""
const create = require('./lib/rewards');
const r = create({}, {});
const at = (s) => r.mondayISO(new Date(s));
console.log(JSON.stringify({
  sunday: at('2026-11-22T10:00:00Z'),
  mondayEarly: at('2026-11-23T00:30:00Z'),
  sameWeek: [
    at('2026-11-16T00:00:00Z'), at('2026-11-18T12:00:00Z'),
    at('2026-11-22T23:59:59Z')
  ],
  steps: r.PLAY_STEPS,
  weeks: r.WEEK_QUESTS,
  mb: r.MB,
  api: ['list', 'claim', 'onPlay', 'onPublish', 'onScratchImport', 'storageBonus']
    .filter((k) => typeof r[k] === 'function')
}));
"""


def load():
    out = subprocess.run(
        ['node', '-e', NODE], cwd=ROOT, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


class RewardTuning(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load()

    def test_week_key_is_the_monday(self):
        self.assertEqual(self.data['sunday'], '2026-11-16')
        self.assertEqual(self.data['mondayEarly'], '2026-11-23')

    def test_week_key_is_stable_inside_a_week(self):
        self.assertEqual(len(set(self.data['sameWeek'])), 1)
        self.assertEqual(self.data['sameWeek'][0], '2026-11-16')

    def test_play_steps_ascend(self):
        steps = self.data['steps']
        plays = [s['plays'] for s in steps]
        players = [s['players'] for s in steps]
        coins = [s['coins'] for s in steps]
        self.assertEqual(plays, sorted(plays))
        self.assertEqual(players, sorted(players))
        self.assertEqual(coins, sorted(coins))

    def test_every_play_step_needs_real_players(self):
        for step in self.data['steps']:
            self.assertGreaterEqual(step['players'], 3)
            self.assertLessEqual(step['players'], step['plays'])

    def test_weekly_quests_are_distinct_and_priced_like_quests(self):
        ids = [w['id'] for w in self.data['weeks']]
        self.assertEqual(len(ids), len(set(ids)))
        for w in self.data['weeks']:
            self.assertGreaterEqual(w['coins'], 25)
            self.assertLessEqual(w['coins'], 50)

    def test_storage_unit_is_a_real_megabyte(self):
        self.assertEqual(self.data['mb'], 1048576)

    def test_module_exposes_the_hooks_server_wires(self):
        self.assertEqual(
            set(self.data['api']),
            {'list', 'claim', 'onPlay', 'onPublish', 'onScratchImport', 'storageBonus'},
        )


if __name__ == '__main__':
    unittest.main(verbosity=2)
