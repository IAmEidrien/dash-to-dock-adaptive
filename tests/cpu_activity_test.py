# SPDX-FileCopyrightText: Eidrien
# SPDX-License-Identifier: MIT
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker', Path(__file__).parents[1] / 'cpu_activity.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CpuWorkerTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.proc = Path(self.directory.name)

    def process(self, pid, ppid, ticks, start=10):
        path = self.proc / str(pid)
        path.mkdir(exist_ok=True)
        fields = ['0'] * 30
        fields[0], fields[1], fields[11], fields[19] = 'S', str(ppid), str(ticks), str(start)
        (path / 'stat').write_text(f'{pid} (name with ) parentheses) ' + ' '.join(fields))

    def sample(self, previous=None, apps=None, now=100):
        with patch.object(worker.time, 'monotonic', return_value=now), \
             patch.object(worker.os, 'sysconf', return_value=100):
            return worker.sample({'apps': apps or {'app': [100]}, 'previous': previous}, self.proc)

    def test_descendants_and_actual_values_above_one_core(self):
        self.process(100, 1, 100)
        self.process(101, 100, 50)
        first = self.sample()
        self.assertIsNone(first['apps']['app']['percent'])
        self.process(100, 1, 400)
        self.process(101, 100, 350)
        second = self.sample(first, now=102)
        self.assertEqual(second['apps']['app']['percent'], 300)
        self.assertEqual(second['apps']['app']['processes'], 2)

    def test_shared_roots_and_missing_roots_are_unavailable(self):
        self.process(100, 1, 100)
        first = self.sample()
        second = self.sample(first, {'app': [100], 'other': [100]}, 102)
        self.assertIsNone(second['apps']['app']['percent'])
        self.assertIsNone(second['apps']['other']['percent'])
        self.assertIsNone(self.sample(first, {'app': [100, 999]}, 102)['apps']['app']['percent'])

    def test_reused_pid_and_process_churn_warm_up(self):
        self.process(100, 1, 100)
        first = self.sample()
        self.process(100, 1, 300, start=20)
        self.assertIsNone(self.sample(first, now=102)['apps']['app']['percent'])

    def test_idle_retains_valid_zero(self):
        self.process(100, 1, 100)
        first = self.sample()
        self.assertEqual(self.sample(first, now=102)['apps']['app']['percent'], 0)
