from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    papers: Mapped[list["Paper"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Paper(Base):
    __tablename__ = "papers"
    __table_args__ = (Index("ix_papers_owner_last_read", "owner_id", "last_read_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    original_filename: Mapped[str] = mapped_column(String(500))
    stored_filename: Mapped[str] = mapped_column(String(100))
    local_file_path: Mapped[str] = mapped_column(String(1000))
    mime_type: Mapped[str] = mapped_column(String(100))
    file_size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    authors: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    journal: Mapped[str | None] = mapped_column(String(500), nullable=True)
    doi: Mapped[str | None] = mapped_column(String(500), nullable=True)
    openalex_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    citation_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    oa_pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain: Mapped[str | None] = mapped_column(String(50), nullable=True)
    study_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    template: Mapped[str | None] = mapped_column(String(80), nullable=True)
    current_unit_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="uploaded")
    parse_warning: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user: Mapped[User] = relationship(back_populates="papers")
    messages: Mapped[list["Message"]] = relationship(back_populates="paper", cascade="all, delete-orphan")
    units: Mapped[list["ReadingUnit"]] = relationship(back_populates="paper", cascade="all, delete-orphan")
    images: Mapped[list["PaperImage"]] = relationship(back_populates="paper", cascade="all, delete-orphan")


class ReadingUnit(Base):
    __tablename__ = "reading_units"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(30))
    heading: Mapped[str] = mapped_column(String(500))
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_text: Mapped[str] = mapped_column(Text, default="")
    paper: Mapped[Paper] = relationship(back_populates="units")


class PaperImage(Base):
    __tablename__ = "paper_images"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), index=True)
    page_number: Mapped[int] = mapped_column(Integer)
    xref: Mapped[int] = mapped_column(Integer)
    local_file_path: Mapped[str] = mapped_column(String(1000))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    paper: Mapped[Paper] = relationship(back_populates="images")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_paper_created", "paper_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    paper_id: Mapped[str] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    action: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reading_unit_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="completed")
    visual_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    paper: Mapped[Paper] = relationship(back_populates="messages")


class ResearchArtifact(Base):
    __tablename__ = "research_artifacts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    paper_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    payload_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResearchWorkspace(Base):
    __tablename__ = "research_workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    query: Mapped[str] = mapped_column(Text, default="")
    domain: Mapped[str] = mapped_column(String(50), default="general")
    study_type: Mapped[str] = mapped_column(String(80), default="unspecified")
    selected_paper_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    core_paper_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    synthesis_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    research_gap: Mapped[str] = mapped_column(Text, default="")
    gap_context_json: Mapped[str] = mapped_column(Text, default="{}")
    design_idea: Mapped[str] = mapped_column(Text, default="")
    novelty_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    design_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class DesignVersion(Base):
    __tablename__ = "design_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("research_workspaces.id", ondelete="CASCADE"), index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("research_artifacts.id", ondelete="CASCADE"), unique=True)
    version_number: Mapped[int] = mapped_column(Integer)
    parent_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    changed_nodes_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DiscoveryCache(Base):
    __tablename__ = "discovery_cache"
    cache_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    query: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(20), default="")
    page: Mapped[int] = mapped_column(Integer, default=1)
    payload_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
