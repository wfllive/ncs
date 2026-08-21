from setuptools import setup, find_packages

setup(
    name="storm-engine-build",
    version="2026.2.0",
    description="Storm Build 2026 — Android APK/AAB toolchain without Gradle (Yandex Ads / AndroidX safe)",
    author="Storm Engine Studio",
    packages=find_packages(),
    package_data={"storm_engine": ["assets/ic_launcher.png"]},
    include_package_data=True,
    entry_points={
        "console_scripts": [
            "storm=storm_engine.cli:main",
        ],
    },
    python_requires=">=3.8",
)
