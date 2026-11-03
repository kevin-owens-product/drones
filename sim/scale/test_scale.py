"""Unit checks for sim/scale. Run: make test-scale (stdlib unittest, < 20 s)."""
import ctypes
import pathlib
import random
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import fleet  # noqa: E402

ALLOC = pathlib.Path(__file__).resolve().parents[2] / "onboard" / "alloc"


class Agent(ctypes.Structure):
    _fields_ = [("id", ctypes.c_int), ("x", ctypes.c_double), ("y", ctypes.c_double), ("alive", ctypes.c_int)]


class Task(ctypes.Structure):
    _fields_ = [("id", ctypes.c_int), ("x", ctypes.c_double), ("y", ctypes.c_double), ("reward", ctypes.c_double)]


class Plan(ctypes.Structure):
    _fields_ = [("winner", ctypes.c_int * 16), ("bid", ctypes.c_double * 16),
                ("bundle", (ctypes.c_int * 4) * 8), ("bundle_n", ctypes.c_int * 8)]


class CbbaPortMatchesC(unittest.TestCase):
    """The Python greedy port gives the same winners as onboard/alloc cbba_assign."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        so = pathlib.Path(cls.tmp.name) / "libcbba.so"
        subprocess.run(["cc", "-std=c17", "-O2", "-shared", "-fPIC", f"-I{ALLOC / 'include'}",
                        "-o", str(so), str(ALLOC / "src" / "cbba.c"), "-lm"], check=True)
        cls.lib = ctypes.CDLL(str(so))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_random_worlds(self):
        rng = random.Random(7)
        worlds = 200
        same = 0
        for _ in range(worlds):
            na, nt = rng.randint(2, 6), rng.randint(3, 12)
            ag = [(rng.uniform(0, 500), rng.uniform(0, 500)) for _ in range(na)]
            tk = [(rng.uniform(0, 500), rng.uniform(0, 500), 1.0) for _ in range(nt)]
            ca = (Agent * na)(*[Agent(i, x, y, 1) for i, (x, y) in enumerate(ag)])
            ct = (Task * nt)(*[Task(j, x, y, r) for j, (x, y, r) in enumerate(tk)])
            plan = Plan()
            self.lib.cbba_assign(ca, na, ct, nt, ctypes.byref(plan))
            c_paths = [[plan.bundle[a][k] for k in range(plan.bundle_n[a])] for a in range(na)]
            py_paths = fleet.greedy_cbba(ag, tk, 4)
            c_win = {j: a for a, p in enumerate(c_paths) for j in p}
            py_win = {j: a for a, p in enumerate(py_paths) for j in p}
            same += c_win == py_win
        print(f"\ncbba port vs C: {same}/{worlds} worlds identical", file=sys.stderr)
        # Unit check: the port must give the same winners as the C code on every world.
        self.assertEqual(same, worlds, f"{same}/{worlds} worlds match")


class FleetSim(unittest.TestCase):
    def test_no_exceptions_completes(self):
        r = fleet.run(fleet.Params(n=10, rate_scale=0.0))
        self.assertTrue(r.success)
        self.assertEqual(r.events, 0)
        self.assertEqual(r.interventions, 0)

    def test_no_task_done_twice_and_reallocation(self):
        r = fleet.run(fleet.Params(n=20, rate_scale=6.0, seed=3))
        self.assertLessEqual(r.tasks_done, r.tasks_total)
        self.assertGreater(r.vehicles_lost, 0)
        self.assertGreater(r.reallocations, 0)

    def test_success_falls_with_load(self):
        lo = fleet.sweep([5], seeds=5)[0]
        hi = fleet.sweep([100], seeds=3)[0]
        self.assertEqual(lo["success"], 1.0)
        self.assertLess(hi["success"], lo["success"])
        self.assertGreater(hi["operator_util"], lo["operator_util"])

    def test_deterministic(self):
        a = fleet.run(fleet.Params(n=10, seed=4))
        b = fleet.run(fleet.Params(n=10, seed=4))
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
