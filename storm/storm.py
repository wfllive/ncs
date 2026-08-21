#!/usr/bin/env python3
"""
Storm Build CLI Launcher.
"""

import sys
import os

# Add repo root to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from storm_engine.cli import main

if __name__ == "__main__":
    main()
