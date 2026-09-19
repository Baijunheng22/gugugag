from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from mutagen.mp3 import MP3
from PySide6.QtCore import Qt, Signal, QDate
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
    QDoubleSpinBox,
)

APP_NAME = "声账 VoiceLedger"
DB_PATH = Path(__file__).with_name("voiceledger.db")

PLATFORMS = [
    "喜马拉雅",
    "番茄畅听",
    "懒人听书",
    "蜻蜓FM",
    "微信听书",
    "酷我畅听",
    "网易云音乐",
    "其他",
]
ROLE_TYPES = ["男主", "男配", "旁白", "群杂", "其他"]
PROJECT_STATUSES = ["连载中", "已完结", "暂停"]


# ---------- helpers ----------

def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def sec_to_hms(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    return f"{m}m {s:02d}s"


def sec_to_clock(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def money(v: float) -> str:
    return f"¥{v:,.2f}"


def fingerprint_file(path: Path) -> str:
    size = path.stat().st_size
    h = hashlib.sha1()
    h.update(str(size).encode("utf-8"))
    with path.open("rb") as f:
        head = f.read(65536)
        h.update(head)
        if size > 65536:
            f.seek(max(0, size - 65536))
            h.update(f.read(65536))
    return h.hexdigest()


def mp3_duration(path: Path) -> float:
    return float(MP3(path).info.length)


@dataclass
class ParsedFile:
    path: Path
    project_id: int
    project_title: str
    alias: str
    start_episode: int
    end_episode: int
    duration_seconds: float
    file_size: int
    source_mtime: float
    record_date: str
    fingerprint: str
    duplicate: bool = False


# ---------- database ----------
class Database:
    def __init__(self, path: Path):
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.init_schema()

    def init_schema(self):
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                client TEXT DEFAULT '',
                platform TEXT DEFAULT '',
                role_type TEXT DEFAULT '',
                role_name TEXT DEFAULT '',
                rate_per_hour REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT '连载中',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_aliases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                alias TEXT NOT NULL COLLATE NOCASE,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE(alias)
            );

            CREATE TABLE IF NOT EXISTS recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE,
                duration_seconds REAL NOT NULL,
                start_episode INTEGER NOT NULL,
                end_episode INTEGER NOT NULL,
                record_date TEXT NOT NULL,
                source_mtime REAL NOT NULL,
                imported_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settlements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                settled_through_episode INTEGER NOT NULL,
                amount REAL NOT NULL,
                settlement_date TEXT NOT NULL,
                note TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )
        self.conn.commit()

    def close(self):
        self.conn.close()

    def create_project(self, data: dict, aliases: list[str]) -> int:
        try:
            cur = self.conn.execute(
                """INSERT INTO projects
                (title, client, platform, role_type, role_name, rate_per_hour, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    data["title"].strip(),
                    data.get("client", "").strip(),
                    data.get("platform", "").strip(),
                    data.get("role_type", "").strip(),
                    data.get("role_name", "").strip(),
                    float(data.get("rate_per_hour", 0)),
                    data.get("status", "连载中"),
                    now_iso(),
                ),
            )
            project_id = int(cur.lastrowid)
            self.replace_aliases(project_id, aliases)
            self.conn.commit()
            return project_id
        except Exception:
            self.conn.rollback()
            raise

    def update_project(self, project_id: int, data: dict, aliases: list[str]):
        try:
            self.conn.execute(
                """UPDATE projects SET
                title=?, client=?, platform=?, role_type=?, role_name=?, rate_per_hour=?, status=?
                WHERE id=?""",
                (
                    data["title"].strip(),
                    data.get("client", "").strip(),
                    data.get("platform", "").strip(),
                    data.get("role_type", "").strip(),
                    data.get("role_name", "").strip(),
                    float(data.get("rate_per_hour", 0)),
                    data.get("status", "连载中"),
                    project_id,
                ),
            )
            self.replace_aliases(project_id, aliases)
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    def replace_aliases(self, project_id: int, aliases: list[str]):
        clean = []
        seen = set()
        for a in aliases:
            a = a.strip()
            if a and a.lower() not in seen:
                clean.append(a)
                seen.add(a.lower())
        self.conn.execute("DELETE FROM project_aliases WHERE project_id=?", (project_id,))
        for alias in clean:
            self.conn.execute(
                "INSERT INTO project_aliases(project_id, alias) VALUES (?, ?)",
                (project_id, alias),
            )

    def get_projects(self):
        return self.conn.execute(
            """
            SELECT p.*,
                   COALESCE(GROUP_CONCAT(a.alias, ' / '), '') aliases
            FROM projects p
            LEFT JOIN project_aliases a ON a.project_id = p.id
            GROUP BY p.id
            ORDER BY CASE p.status WHEN '连载中' THEN 0 WHEN '暂停' THEN 1 ELSE 2 END, p.id DESC
            """
        ).fetchall()

    def get_project(self, project_id: int):
        return self.conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()

    def get_aliases(self, project_id: int) -> list[str]:
        rows = self.conn.execute(
            "SELECT alias FROM project_aliases WHERE project_id=? ORDER BY LENGTH(alias) DESC",
            (project_id,),
        ).fetchall()
        return [r["alias"] for r in rows]

    def all_aliases(self):
        return self.conn.execute(
            """
            SELECT a.alias, p.id project_id, p.title project_title
            FROM project_aliases a JOIN projects p ON p.id=a.project_id
            ORDER BY LENGTH(a.alias) DESC
            """
        ).fetchall()

    def parse_filename(self, path: Path) -> Optional[tuple[int, str, str, int, int]]:
        stem = path.stem.strip()
        for row in self.all_aliases():
            alias = row["alias"]
            if not stem.lower().startswith(alias.lower()):
                continue
            rest = stem[len(alias):].strip()
            m = re.match(r"^(\d+)\s*[-~—–至]\s*(\d+)(?:\s+.*)?$", rest)
            if not m:
                continue
            start_ep, end_ep = int(m.group(1)), int(m.group(2))
            if start_ep > end_ep:
                start_ep, end_ep = end_ep, start_ep
            return int(row["project_id"]), row["project_title"], alias, start_ep, end_ep
        return None

    def fingerprint_exists(self, fp: str) -> bool:
        row = self.conn.execute("SELECT 1 FROM recordings WHERE fingerprint=?", (fp,)).fetchone()
        return row is not None

    def add_recording(self, item: ParsedFile) -> bool:
        try:
            self.conn.execute(
                """INSERT INTO recordings
                (project_id, file_path, file_name, file_size, fingerprint, duration_seconds,
                 start_episode, end_episode, record_date, source_mtime, imported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    item.project_id,
                    str(item.path),
                    item.path.name,
                    item.file_size,
                    item.fingerprint,
                    item.duration_seconds,
                    item.start_episode,
                    item.end_episode,
                    item.record_date,
                    item.source_mtime,
                    now_iso(),
                ),
            )
            self.conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False

    def add_settlement(self, project_id: int, settled_through: int, amount: float, dt: str, note: str):
        self.conn.execute(
            """INSERT INTO settlements
            (project_id, settled_through_episode, amount, settlement_date, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, settled_through, amount, dt, note.strip(), now_iso()),
        )
        self.conn.commit()

    def settlement_rows(self, project_id: Optional[int] = None):
        if project_id:
            return self.conn.execute(
                """SELECT s.*, p.title FROM settlements s
                JOIN projects p ON p.id=s.project_id
                WHERE s.project_id=? ORDER BY s.settlement_date DESC, s.id DESC""",
                (project_id,),
            ).fetchall()
        return self.conn.execute(
            """SELECT s.*, p.title FROM settlements s
            JOIN projects p ON p.id=s.project_id
            ORDER BY s.settlement_date DESC, s.id DESC"""
        ).fetchall()

    def project_metrics(self, project_id: int):
        project = self.get_project(project_id)
        rec = self.conn.execute(
            """SELECT COALESCE(SUM(duration_seconds),0) dur,
                      COALESCE(MAX(end_episode),0) progress,
                      COUNT(*) files
               FROM recordings WHERE project_id=?""",
            (project_id,),
        ).fetchone()
        sett = self.conn.execute(
            """SELECT COALESCE(SUM(amount),0) received,
                      COALESCE(MAX(settled_through_episode),0) settled_through,
                      COUNT(*) cnt
               FROM settlements WHERE project_id=?""",
            (project_id,),
        ).fetchone()
        duration = float(rec["dur"] or 0)
        rate = float(project["rate_per_hour"] or 0)
        receivable = duration / 3600.0 * rate
        received = float(sett["received"] or 0)
        unreceived = receivable - received
        progress = int(rec["progress"] or 0)
        settled_through = int(sett["settled_through"] or 0)
        if int(sett["cnt"] or 0) == 0:
            settlement_status = "未结算"
        elif progress > 0 and settled_through >= progress:
            settlement_status = "已结清"
        else:
            settlement_status = "部分结算"
        return {
            "duration": duration,
            "progress": progress,
            "files": int(rec["files"] or 0),
            "receivable": receivable,
            "received": received,
            "unreceived": unreceived,
            "settled_through": settled_through,
            "settlement_status": settlement_status,
        }

    def all_project_metrics(self):
        out = []
        for p in self.get_projects():
            m = self.project_metrics(int(p["id"]))
            out.append((p, m))
        return out

    def range_stats(self, start: str, end: str):
        row = self.conn.execute(
            """
            SELECT COALESCE(SUM(r.duration_seconds),0) dur, COUNT(*) files,
                   COUNT(DISTINCT r.project_id) projects,
                   COALESCE(SUM(r.duration_seconds / 3600.0 * p.rate_per_hour),0) receivable
            FROM recordings r JOIN projects p ON p.id=r.project_id
            WHERE r.record_date BETWEEN ? AND ?
            """,
            (start, end),
        ).fetchone()
        return {
            "duration": float(row["dur"] or 0),
            "files": int(row["files"] or 0),
            "projects": int(row["projects"] or 0),
            "receivable": float(row["receivable"] or 0),
        }

    def recent_recordings(self, limit=10):
        return self.conn.execute(
            """SELECT r.*, p.title FROM recordings r JOIN projects p ON p.id=r.project_id
               ORDER BY r.record_date DESC, r.id DESC LIMIT ?""",
            (limit,),
        ).fetchall()


# ---------- small UI pieces ----------
class MetricCard(QFrame):
    def __init__(self, title: str, value: str = "—", subtitle: str = ""):
        super().__init__()
        self.setObjectName("metricCard")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 16, 18, 16)
        t = QLabel(title)
        t.setObjectName("metricTitle")
        self.value = QLabel(value)
        self.value.setObjectName("metricValue")
        self.sub = QLabel(subtitle)
        self.sub.setObjectName("metricSub")
        lay.addWidget(t)
        lay.addWidget(self.value)
        lay.addWidget(self.sub)

    def set_values(self, value: str, subtitle: str = ""):
        self.value.setText(value)
        self.sub.setText(subtitle)


class ProjectDialog(QDialog):
    def __init__(self, db: Database, project_id: Optional[int] = None, parent=None):
        super().__init__(parent)
        self.db = db
        self.project_id = project_id
        self.setWindowTitle("编辑有声书项目" if project_id else "新建有声书项目")
        self.setMinimumWidth(520)

        form = QFormLayout(self)
        self.title = QLineEdit()
        self.aliases = QLineEdit()
        self.aliases.setPlaceholderText("例如：双修；可填多个，用逗号分隔")
        self.client = QLineEdit()
        self.platform = QComboBox(); self.platform.setEditable(True); self.platform.addItems(PLATFORMS)
        self.role_type = QComboBox(); self.role_type.setEditable(True); self.role_type.addItems(ROLE_TYPES)
        self.role_name = QLineEdit()
        self.rate = QDoubleSpinBox(); self.rate.setRange(0, 99999); self.rate.setDecimals(2); self.rate.setSuffix(" 元/成品小时")
        self.status = QComboBox(); self.status.addItems(PROJECT_STATUSES)

        form.addRow("正式书名", self.title)
        form.addRow("文件简称 / 别名", self.aliases)
        form.addRow("甲方", self.client)
        form.addRow("平台", self.platform)
        form.addRow("角色类型", self.role_type)
        form.addRow("角色名", self.role_name)
        form.addRow("单价", self.rate)
        form.addRow("项目状态", self.status)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.save)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

        if project_id:
            self.load_data()

    def load_data(self):
        p = self.db.get_project(self.project_id)
        if not p:
            return
        self.title.setText(p["title"])
        self.aliases.setText("，".join(self.db.get_aliases(self.project_id)))
        self.client.setText(p["client"] or "")
        self.platform.setCurrentText(p["platform"] or "")
        self.role_type.setCurrentText(p["role_type"] or "")
        self.role_name.setText(p["role_name"] or "")
        self.rate.setValue(float(p["rate_per_hour"] or 0))
        self.status.setCurrentText(p["status"] or "连载中")

    def save(self):
        title = self.title.text().strip()
        aliases = [x.strip() for x in re.split(r"[,，;；]", self.aliases.text()) if x.strip()]
        if not title:
            QMessageBox.warning(self, "缺少书名", "请填写正式书名。")
            return
        if not aliases:
            QMessageBox.warning(self, "缺少简称", "至少填写一个用于识别文件名的简称/别名。")
            return
        data = {
            "title": title,
            "client": self.client.text(),
            "platform": self.platform.currentText(),
            "role_type": self.role_type.currentText(),
            "role_name": self.role_name.text(),
            "rate_per_hour": self.rate.value(),
            "status": self.status.currentText(),
        }
        try:
            if self.project_id:
                self.db.update_project(self.project_id, data, aliases)
            else:
                self.db.create_project(data, aliases)
        except sqlite3.IntegrityError:
            QMessageBox.warning(self, "简称冲突", "这个简称已经被另一本书使用，请换一个。")
            return
        self.accept()


class SettlementDialog(QDialog):
    def __init__(self, db: Database, project_id: int, parent=None):
        super().__init__(parent)
        self.db = db
        self.project_id = project_id
        self.setWindowTitle("新增结算记录")
        self.setMinimumWidth(460)
        form = QFormLayout(self)
        self.through = QSpinBox(); self.through.setRange(0, 999999)
        m = db.project_metrics(project_id)
        self.through.setValue(m["progress"])
        self.amount = QDoubleSpinBox(); self.amount.setRange(0, 99999999); self.amount.setDecimals(2); self.amount.setPrefix("¥")
        self.date = QDateEdit(); self.date.setCalendarPopup(True); self.date.setDate(QDate.currentDate())
        self.note = QTextEdit(); self.note.setFixedHeight(80)
        form.addRow("结算到第几集", self.through)
        form.addRow("实际结算金额", self.amount)
        form.addRow("结算日期", self.date)
        form.addRow("备注", self.note)
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.save)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def save(self):
        self.db.add_settlement(
            self.project_id,
            self.through.value(),
            self.amount.value(),
            self.date.date().toString("yyyy-MM-dd"),
            self.note.toPlainText(),
        )
        self.accept()


class DashboardPage(QWidget):
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        root = QVBoxLayout(self)
        root.setContentsMargins(24, 22, 24, 24)
        root.setSpacing(18)
        title = QLabel("有声书 · 工作总览")
        title.setObjectName("pageTitle")
        root.addWidget(title)
        sub = QLabel("今天录了多少、这个月做了多少、钱结到哪儿，一眼看清。")
        sub.setObjectName("pageSub")
        root.addWidget(sub)

        cards = QGridLayout(); cards.setHorizontalSpacing(14); cards.setVerticalSpacing(14)
        self.today_time = MetricCard("今日成品")
        self.today_money = MetricCard("今日理论应收")
        self.month_time = MetricCard("本月成品")
        self.month_money = MetricCard("本月理论应收")
        cards.addWidget(self.today_time, 0, 0)
        cards.addWidget(self.today_money, 0, 1)
        cards.addWidget(self.month_time, 0, 2)
        cards.addWidget(self.month_money, 0, 3)
        root.addLayout(cards)

        lower = QHBoxLayout(); lower.setSpacing(16)
        self.active_box = QFrame(); self.active_box.setObjectName("panel")
        abl = QVBoxLayout(self.active_box)
        h = QLabel("正在做的书"); h.setObjectName("sectionTitle"); abl.addWidget(h)
        self.active_list = QVBoxLayout(); abl.addLayout(self.active_list); abl.addStretch()

        self.recent_box = QFrame(); self.recent_box.setObjectName("panel")
        rbl = QVBoxLayout(self.recent_box)
        h2 = QLabel("最近导入"); h2.setObjectName("sectionTitle"); rbl.addWidget(h2)
        self.recent_list = QVBoxLayout(); rbl.addLayout(self.recent_list); rbl.addStretch()
        lower.addWidget(self.active_box, 3)
        lower.addWidget(self.recent_box, 2)
        root.addLayout(lower, 1)

    def _clear_layout(self, lay):
        while lay.count():
            item = lay.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()

    def refresh(self):
        today = date.today()
        today_s = today.isoformat()
        month_start = today.replace(day=1).isoformat()
        ts = self.db.range_stats(today_s, today_s)
        ms = self.db.range_stats(month_start, today_s)
        self.today_time.set_values(sec_to_hms(ts["duration"]), f"{ts['files']} 个文件 · {ts['projects']} 本书")
        self.today_money.set_values(money(ts["receivable"]), "按各项目当前单价计算")
        self.month_time.set_values(sec_to_hms(ms["duration"]), f"{ms['files']} 个文件 · {ms['projects']} 本书")
        self.month_money.set_values(money(ms["receivable"]), "本月理论应收")

        self._clear_layout(self.active_list)
        active = [(p, m) for p, m in self.db.all_project_metrics() if p["status"] == "连载中"][:6]
        if not active:
            lab = QLabel("还没有连载中的项目。先去“项目”新建一本书。")
            lab.setObjectName("muted")
            self.active_list.addWidget(lab)
        for p, m in active:
            row = QFrame(); row.setObjectName("listRow")
            lay = QHBoxLayout(row); lay.setContentsMargins(12, 10, 12, 10)
            left = QVBoxLayout()
            name = QLabel(p["title"]); name.setObjectName("rowTitle")
            desc = QLabel(f"已录至 {m['progress']} 集 · {sec_to_hms(m['duration'])} · {m['settlement_status']}")
            desc.setObjectName("muted")
            left.addWidget(name); left.addWidget(desc)
            amt = QLabel(money(m["unreceived"])); amt.setObjectName("moneyLabel")
            lay.addLayout(left, 1); lay.addWidget(amt)
            self.active_list.addWidget(row)

        self._clear_layout(self.recent_list)
        rows = self.db.recent_recordings(7)
        if not rows:
            lab = QLabel("还没有导入记录。")
            lab.setObjectName("muted")
            self.recent_list.addWidget(lab)
        for r in rows:
            row = QLabel(f"{r['record_date']}  ·  {r['title']}  ·  {r['start_episode']}-{r['end_episode']}  ·  {sec_to_clock(r['duration_seconds'])}")
            row.setObjectName("recentRow")
            row.setWordWrap(True)
            self.recent_list.addWidget(row)


class ProjectsPage(QWidget):
    changed = Signal()
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        root = QVBoxLayout(self); root.setContentsMargins(24, 22, 24, 24); root.setSpacing(14)
        top = QHBoxLayout()
        title = QLabel("有声书项目")
        title.setObjectName("pageTitle")
        top.addWidget(title); top.addStretch()
        add = QPushButton("＋ 新建项目"); add.setObjectName("primaryButton"); add.clicked.connect(self.add_project)
        edit = QPushButton("编辑选中"); edit.clicked.connect(self.edit_project)
        settle = QPushButton("新增结算"); settle.setObjectName("accentButton"); settle.clicked.connect(self.add_settlement)
        top.addWidget(add); top.addWidget(edit); top.addWidget(settle)
        root.addLayout(top)
        sub = QLabel("正式书名负责归档，简称负责认文件。结算状态和项目状态是两套独立逻辑。")
        sub.setObjectName("pageSub"); root.addWidget(sub)

        self.table = QTableWidget(0, 13)
        self.table.setHorizontalHeaderLabels([
            "书名", "简称", "甲方", "平台", "角色", "单价", "项目状态", "当前进度",
            "累计时长", "应收", "已收", "未收", "结算状态"
        ])
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        root.addWidget(self.table, 1)

    def selected_project_id(self) -> Optional[int]:
        row = self.table.currentRow()
        if row < 0:
            return None
        item = self.table.item(row, 0)
        return int(item.data(Qt.UserRole)) if item else None

    def add_project(self):
        dlg = ProjectDialog(self.db, parent=self)
        if dlg.exec():
            self.refresh(); self.changed.emit()

    def edit_project(self):
        pid = self.selected_project_id()
        if not pid:
            QMessageBox.information(self, "先选一本书", "请先选中要编辑的项目。")
            return
        dlg = ProjectDialog(self.db, pid, self)
        if dlg.exec():
            self.refresh(); self.changed.emit()

    def add_settlement(self):
        pid = self.selected_project_id()
        if not pid:
            QMessageBox.information(self, "先选一本书", "请先选中要添加结算记录的项目。")
            return
        dlg = SettlementDialog(self.db, pid, self)
        if dlg.exec():
            self.refresh(); self.changed.emit()

    def refresh(self):
        items = self.db.all_project_metrics()
        self.table.setRowCount(len(items))
        for i, (p, m) in enumerate(items):
            role = " / ".join(x for x in [p["role_type"], p["role_name"]] if x)
            vals = [
                p["title"], p["aliases"], p["client"], p["platform"], role,
                f"¥{float(p['rate_per_hour']):.0f}/h", p["status"],
                f"{m['progress']} 集" if m["progress"] else "—",
                sec_to_hms(m["duration"]), money(m["receivable"]), money(m["received"]),
                money(m["unreceived"]), m["settlement_status"]
            ]
            for c, v in enumerate(vals):
                item = QTableWidgetItem(str(v or ""))
                if c == 0:
                    item.setData(Qt.UserRole, int(p["id"]))
                self.table.setItem(i, c, item)


class ImportPage(QWidget):
    imported = Signal()
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        self.scanned: list[ParsedFile] = []
        root = QVBoxLayout(self); root.setContentsMargins(24, 22, 24, 24); root.setSpacing(14)
        title = QLabel("导入正式成品")
        title.setObjectName("pageTitle"); root.addWidget(title)
        sub = QLabel("只扫正式 MP3。文件简称匹配到项目后，自动读取时长、集数、日期并入账。")
        sub.setObjectName("pageSub"); root.addWidget(sub)

        bar = QHBoxLayout()
        self.folder = QLineEdit(); self.folder.setPlaceholderText("选择存放正式成品的文件夹")
        browse = QPushButton("选择文件夹"); browse.clicked.connect(self.choose_folder)
        scan = QPushButton("扫描"); scan.setObjectName("primaryButton"); scan.clicked.connect(self.scan_folder)
        imp = QPushButton("导入识别结果"); imp.setObjectName("accentButton"); imp.clicked.connect(self.import_results)
        bar.addWidget(self.folder, 1); bar.addWidget(browse); bar.addWidget(scan); bar.addWidget(imp)
        root.addLayout(bar)

        self.summary = QLabel("尚未扫描")
        self.summary.setObjectName("infoBanner"); root.addWidget(self.summary)
        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(["状态", "项目", "集数", "时长", "记录日期", "文件名", "路径"])
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.Stretch)
        root.addWidget(self.table, 1)

        note = QLabel("V1 记录日期取文件“最后修改日期”，这样第一次导入旧文件时不会全算到今天。以后可再加手动改日期。")
        note.setObjectName("muted"); note.setWordWrap(True); root.addWidget(note)

    def choose_folder(self):
        p = QFileDialog.getExistingDirectory(self, "选择正式成品文件夹")
        if p:
            self.folder.setText(p)

    def scan_folder(self):
        folder = Path(self.folder.text().strip())
        if not folder.is_dir():
            QMessageBox.warning(self, "文件夹无效", "请先选择一个有效文件夹。")
            return
        if not self.db.get_projects():
            QMessageBox.information(self, "先建项目", "还没有有声书项目。请先去“项目”建立正式书名和文件简称。")
            return

        self.scanned = []
        unrecognized = 0
        errors = 0
        mp3s = sorted(folder.rglob("*.mp3"))
        for path in mp3s:
            parsed = self.db.parse_filename(path)
            if not parsed:
                unrecognized += 1
                continue
            pid, ptitle, alias, start_ep, end_ep = parsed
            try:
                stat = path.stat()
                fp = fingerprint_file(path)
                dur = mp3_duration(path)
                dt = datetime.fromtimestamp(stat.st_mtime).date().isoformat()
                item = ParsedFile(
                    path=path,
                    project_id=pid,
                    project_title=ptitle,
                    alias=alias,
                    start_episode=start_ep,
                    end_episode=end_ep,
                    duration_seconds=dur,
                    file_size=stat.st_size,
                    source_mtime=stat.st_mtime,
                    record_date=dt,
                    fingerprint=fp,
                    duplicate=self.db.fingerprint_exists(fp),
                )
                self.scanned.append(item)
            except Exception:
                errors += 1

        self.refresh_table()
        recognized = len(self.scanned)
        new_count = sum(1 for x in self.scanned if not x.duplicate)
        dup = recognized - new_count
        self.summary.setText(
            f"找到 {len(mp3s)} 个 MP3 · 成功识别 {recognized} · 可导入 {new_count} · 已导入过 {dup} · 未识别 {unrecognized} · 读取失败 {errors}"
        )

    def refresh_table(self):
        self.table.setRowCount(len(self.scanned))
        for i, x in enumerate(self.scanned):
            vals = [
                "已导入过" if x.duplicate else "可导入",
                x.project_title,
                f"{x.start_episode}-{x.end_episode}",
                sec_to_clock(x.duration_seconds),
                x.record_date,
                x.path.name,
                str(x.path.parent),
            ]
            for c, v in enumerate(vals):
                self.table.setItem(i, c, QTableWidgetItem(str(v)))

    def import_results(self):
        if not self.scanned:
            QMessageBox.information(self, "没有结果", "请先扫描文件夹。")
            return
        ok = 0
        skipped = 0
        for item in self.scanned:
            if item.duplicate:
                skipped += 1
                continue
            if self.db.add_recording(item):
                ok += 1
                item.duplicate = True
            else:
                skipped += 1
        self.refresh_table()
        self.imported.emit()
        QMessageBox.information(self, "导入完成", f"新增 {ok} 条录音记录；跳过 {skipped} 条重复记录。")


class SettlementsPage(QWidget):
    changed = Signal()
    def __init__(self, db: Database):
        super().__init__()
        self.db = db
        root = QVBoxLayout(self); root.setContentsMargins(24, 22, 24, 24); root.setSpacing(14)
        top = QHBoxLayout()
        title = QLabel("结算流水"); title.setObjectName("pageTitle")
        top.addWidget(title); top.addStretch()
        self.project = QComboBox(); self.project.setMinimumWidth(240)
        add = QPushButton("＋ 新增结算"); add.setObjectName("accentButton"); add.clicked.connect(self.add_settlement)
        top.addWidget(self.project); top.addWidget(add)
        root.addLayout(top)
        sub = QLabel("每次记“结算到第几集 + 实际到账金额”。总应收和已收分开算，方便看差额。")
        sub.setObjectName("pageSub"); root.addWidget(sub)

        self.cards = QGridLayout(); self.cards.setSpacing(12)
        self.c_status = MetricCard("结算状态")
        self.c_through = MetricCard("已结算至")
        self.c_received = MetricCard("累计已收")
        self.c_unreceived = MetricCard("当前未收")
        self.cards.addWidget(self.c_status, 0, 0); self.cards.addWidget(self.c_through, 0, 1)
        self.cards.addWidget(self.c_received, 0, 2); self.cards.addWidget(self.c_unreceived, 0, 3)
        root.addLayout(self.cards)

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["日期", "书名", "结算到", "金额", "备注"])
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        root.addWidget(self.table, 1)
        self.project.currentIndexChanged.connect(self.refresh_details)

    def reload_projects(self):
        current = self.project.currentData()
        self.project.blockSignals(True)
        self.project.clear()
        for p in self.db.get_projects():
            self.project.addItem(p["title"], int(p["id"]))
        if current:
            idx = self.project.findData(current)
            if idx >= 0: self.project.setCurrentIndex(idx)
        self.project.blockSignals(False)
        self.refresh_details()

    def add_settlement(self):
        pid = self.project.currentData()
        if not pid:
            QMessageBox.information(self, "没有项目", "请先建立一个有声书项目。")
            return
        dlg = SettlementDialog(self.db, int(pid), self)
        if dlg.exec():
            self.refresh_details(); self.changed.emit()

    def refresh_details(self):
        pid = self.project.currentData()
        if not pid:
            self.table.setRowCount(0)
            for c in [self.c_status, self.c_through, self.c_received, self.c_unreceived]: c.set_values("—")
            return
        m = self.db.project_metrics(int(pid))
        self.c_status.set_values(m["settlement_status"], f"当前进度 {m['progress']} 集")
        self.c_through.set_values(f"{m['settled_through']} 集" if m["settled_through"] else "—")
        self.c_received.set_values(money(m["received"]), f"理论应收 {money(m['receivable'])}")
        self.c_unreceived.set_values(money(m["unreceived"]), "理论应收 - 实际已收")
        rows = self.db.settlement_rows(int(pid))
        self.table.setRowCount(len(rows))
        for i, r in enumerate(rows):
            vals = [r["settlement_date"], r["title"], f"第 {r['settled_through_episode']} 集", money(r["amount"]), r["note"]]
            for c, v in enumerate(vals): self.table.setItem(i, c, QTableWidgetItem(str(v or "")))


class FuturePage(QWidget):
    def __init__(self):
        super().__init__()
        lay = QVBoxLayout(self); lay.setContentsMargins(30, 30, 30, 30)
        t = QLabel("其他配音板块")
        t.setObjectName("pageTitle")
        p = QLabel("这里先留作扩展位。以后可以把商配、短剧、动配做成各自独立的工作流，不和有声书硬塞在一起。")
        p.setObjectName("pageSub"); p.setWordWrap(True)
        lay.addWidget(t); lay.addWidget(p); lay.addStretch()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.db = Database(DB_PATH)
        self.setWindowTitle(APP_NAME)
        self.resize(1380, 860)
        self.setMinimumSize(1100, 700)

        base = QWidget(); self.setCentralWidget(base)
        root = QHBoxLayout(base); root.setContentsMargins(0, 0, 0, 0); root.setSpacing(0)

        sidebar = QFrame(); sidebar.setObjectName("sidebar"); sidebar.setFixedWidth(220)
        sl = QVBoxLayout(sidebar); sl.setContentsMargins(16, 20, 16, 20); sl.setSpacing(8)
        brand = QLabel("声账")
        brand.setObjectName("brand")
        sub = QLabel("VoiceLedger · V1")
        sub.setObjectName("brandSub")
        sl.addWidget(brand); sl.addWidget(sub); sl.addSpacing(20)

        self.nav = QListWidget(); self.nav.setObjectName("nav")
        self.nav.setSpacing(4)
        for text in ["总览", "有声书项目", "导入录音", "结算流水", "其他板块（后续）"]:
            QListWidgetItem(text, self.nav)
        self.nav.setCurrentRow(0)
        sl.addWidget(self.nav, 1)
        foot = QLabel("数据只保存在本机 SQLite\n数据库：voiceledger.db")
        foot.setObjectName("sidebarFoot")
        sl.addWidget(foot)

        self.stack = QStackedWidget()
        self.dashboard = DashboardPage(self.db)
        self.projects = ProjectsPage(self.db)
        self.importer = ImportPage(self.db)
        self.settlements = SettlementsPage(self.db)
        self.future = FuturePage()
        for p in [self.dashboard, self.projects, self.importer, self.settlements, self.future]: self.stack.addWidget(p)
        root.addWidget(sidebar); root.addWidget(self.stack, 1)

        self.nav.currentRowChanged.connect(self.switch_page)
        self.projects.changed.connect(self.refresh_all)
        self.importer.imported.connect(self.refresh_all)
        self.settlements.changed.connect(self.refresh_all)
        self.refresh_all()

    def switch_page(self, idx: int):
        self.stack.setCurrentIndex(idx)
        if idx == 0: self.dashboard.refresh()
        elif idx == 1: self.projects.refresh()
        elif idx == 3: self.settlements.reload_projects()

    def refresh_all(self):
        self.dashboard.refresh()
        self.projects.refresh()
        self.settlements.reload_projects()

    def closeEvent(self, event):
        self.db.close()
        super().closeEvent(event)


def apply_style(app: QApplication):
    app.setFont(QFont("Microsoft YaHei UI", 10))
    app.setStyleSheet(
        """
        QWidget { background: #f5f6f8; color: #1f2329; }
        QMainWindow { background: #f5f6f8; }
        #sidebar { background: #171a20; }
        #brand { color: white; font-size: 26px; font-weight: 800; background: transparent; }
        #brandSub { color: #8e97a8; background: transparent; }
        #sidebarFoot { color: #7f8794; font-size: 11px; background: transparent; }
        #nav { background: transparent; border: none; color: #cbd1dc; outline: none; }
        #nav::item { padding: 12px 12px; margin: 2px 0; border-radius: 8px; }
        #nav::item:selected { background: #2c63ff; color: white; }
        #nav::item:hover { background: #242934; }
        #pageTitle { font-size: 24px; font-weight: 800; }
        #pageSub { color: #69707d; margin-bottom: 6px; }
        #sectionTitle { font-size: 15px; font-weight: 700; }
        #metricCard, #panel { background: white; border: 1px solid #e5e7eb; border-radius: 12px; }
        #metricTitle { color: #6c7480; font-size: 12px; }
        #metricValue { font-size: 24px; font-weight: 800; margin-top: 4px; }
        #metricSub, #muted { color: #8a929f; font-size: 12px; }
        #listRow { background: #fafbfc; border: 1px solid #eceef2; border-radius: 9px; }
        #rowTitle { font-weight: 700; }
        #moneyLabel { color: #0f8a5f; font-weight: 800; font-size: 15px; }
        #recentRow { padding: 7px 2px; color: #444b55; border-bottom: 1px solid #eff1f4; }
        QPushButton { background: white; border: 1px solid #d9dde5; border-radius: 8px; padding: 8px 13px; }
        QPushButton:hover { background: #f0f2f6; }
        #primaryButton { background: #2c63ff; color: white; border: none; font-weight: 700; }
        #primaryButton:hover { background: #2457e8; }
        #accentButton { background: #151922; color: white; border: none; font-weight: 700; }
        #accentButton:hover { background: #252b36; }
        QLineEdit, QComboBox, QDoubleSpinBox, QSpinBox, QDateEdit, QTextEdit {
            background: white; border: 1px solid #d9dde5; border-radius: 7px; padding: 7px;
        }
        QTableWidget { background: white; border: 1px solid #e2e5ea; border-radius: 10px; gridline-color: #eef0f3; }
        QHeaderView::section { background: #f8f9fb; padding: 8px; border: none; border-bottom: 1px solid #e2e5ea; font-weight: 700; }
        #infoBanner { background: #eef4ff; color: #2856c5; border: 1px solid #d8e5ff; border-radius: 8px; padding: 10px; }
        """
    )


def main():
    app = QApplication(sys.argv)
    apply_style(app)
    w = MainWindow()
    w.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
