from types import SimpleNamespace

from src import rag_config, rag_service


def retrieved(text="The conveyor speed is 2 meters per second.", score=0.9):
    return [SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(text=text, section="Specifications", page=3),
        document=SimpleNamespace(id=1, title="Guide"),
    )]


def _stub_context(monkeypatch, n_ctx=4096):
    monkeypatch.setattr(rag_service.llm_adapter, "context_size", lambda: n_ctx)
    monkeypatch.setattr(rag_service.llm_adapter, "count_tokens", lambda text: len(text.split()))


def test_answer_prompt_contains_retrieved_text(monkeypatch):
    chunks = retrieved()
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: chunks,
    )
    _stub_context(monkeypatch)
    prompts = []
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: prompts.append(prompt) or "2 m/s")

    response = rag_service.answer("What is the speed?", object())

    assert "The conveyor speed is 2 meters per second." in prompts[0]
    assert response["answer"] == "2 m/s"
    assert response["context"]["chunks_dropped"] == 0
    assert response["context"]["fits"] is True


def test_answer_returns_not_found_below_threshold(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(score=0.2),
    )

    response = rag_service.answer("Unrelated", object())

    assert response["not_found"] is True
    assert response["answer"] is None
    assert response["citations"] == []


def test_answer_citations_match_retrieved_chunks(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    response = rag_service.answer("Question", object())

    assert response["citations"] == [{
        "doc_id": 1, "title": "Guide", "section": "Specifications", "page": 3, "score": 0.9,
    }]


def test_answer_treats_a_model_refusal_as_not_found(monkeypatch):
    """Retrieval clearing MIN_SIMILARITY does not mean the chunks hold the answer. When the
    model reads them and declines, the turn must not list them as sources for a non-answer."""
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(score=0.49),
    )
    _stub_context(monkeypatch)
    monkeypatch.setattr(
        rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "I don't have any information about a cat."
    )

    response = rag_service.answer("How is the cat doing?", object())

    assert response["not_found"] is True
    assert response["answer"] is None
    assert response["citations"] == []
    assert response["suggestion"] == rag_service.NOT_FOUND_SUGGESTION


def test_is_refusal_recognises_common_ways_of_saying_not_available():
    for reply in (
        "The answer is not available in the documentation.",
        "That information is not available.",
        "I don't have any information about a cat.",
        "I do not have information on that.",
        "I couldn't find that in the documentation.",
        "The documentation does not contain information about the cat.",
        "The provided documentation doesn't mention a cat.",
        "There is no information about a cat.",
        "Sorry, I cannot find any details about that.",
        "Unfortunately, the documentation does not say.",
        "It's not mentioned in the documentation.",
        "Not specified in the documentation.",
        "I am not available to answer this question.",
        "  i  don’t have any information about a dog.  ",
    ):
        assert rag_service.is_refusal(reply), reply


def test_is_refusal_leaves_real_answers_alone():
    for reply in (
        None,
        "",
        "cat is happy and makes sounds like meow",
        "Samo Susa studied at VIA University College, Horsens.",
        "No, the conveyor has no emergency brake.",
        "The documentation does not mention the exact speed, but the conveyor runs at 2 m/s.",
        "I don't have the exact figure; however, the manual lists 2 m/s as the nominal speed.",
        "There is no information about a cat. " + "The rest of this reply keeps going. " * 10,
    ):
        assert not rag_service.is_refusal(reply), reply


def _stub_generate(monkeypatch, rewrite="What are Samo Susa's hobbies?", answer="answer"):
    """One generate() now serves two callers - the query rewriter and the answer itself -
    so the stub tells them apart by the rewriter's own prompt tail."""
    prompts = []

    def fake_generate(prompt, max_tokens):
        prompts.append(prompt)
        return rewrite if prompt.rstrip().endswith("Standalone question:") else answer

    monkeypatch.setattr(rag_service.llm_adapter, "generate", fake_generate)
    return prompts


def test_answer_retrieves_on_the_standalone_rewrite_not_a_concatenation(monkeypatch):
    """The Samo Susa scenario. A pronoun-only follow-up has to reach FAISS carrying its
    subject - but as ONE coherent question, not two glued together. Concatenating the
    prior question embeds an average of two topics, which ranks documents about neither
    well; that is the failure this replaced."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    # Both the rewrite and the user's own words are searched and fused (RRF).
    assert captured_queries == ["What are Samo Susa's hobbies?", "What are his hobbies?"]
    assert "\n" not in captured_queries[0]  # never a concatenation of turns
    assert response["search"] == {
        "query": "What are Samo Susa's hobbies?",
        "rewritten": True,
        "reason": "rewritten from conversation",
        "queries": ["What are Samo Susa's hobbies?", "What are his hobbies?"],
        "fusion": "rrf",
    }


def test_fallback_mode_searches_only_the_rewrite_when_it_finds_something(monkeypatch):
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    with rag_config.override(fusion="fallback"):
        response = rag_service.answer(
            "What are his hobbies?",
            object(),
            history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
        )

    assert captured_queries == ["What are Samo Susa's hobbies?"]
    assert response["search"] == {
        "query": "What are Samo Susa's hobbies?",
        "rewritten": True,
        "reason": "rewritten from conversation",
    }


def test_rrf_still_finds_the_passage_when_the_rewrite_finds_nothing(monkeypatch):
    """Fusion makes the fallback unnecessary: the literal ranking is always in the merge."""
    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        return [] if query == "What are Samo Susa's hobbies?" else retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert response["not_found"] is False
    assert response["citations"]


def _scored(*scores):
    return [
        SimpleNamespace(
            score=score,
            chunk=SimpleNamespace(text=f"passage {i}", section=None, page=None, chunk_index=i),
            document=SimpleNamespace(id=1, title="Guide"),
        )
        for i, score in enumerate(scores)
    ]


def test_relative_selection_keeps_the_minimum_behind_one_clear_winner():
    # The mentor's first example: one passage far ahead of the rest.
    selected = rag_service.select_by_relative_score(_scored(0.82, 0.51, 0.48, 0.45), 0.85, 2, 8)
    assert [item.score for item in selected] == [0.82, 0.51]


def test_relative_selection_keeps_a_flat_run_of_close_scores():
    # The mentor's second example: 0.85 x 0.71 = 0.6035, so all five pass.
    selected = rag_service.select_by_relative_score(_scored(0.71, 0.69, 0.68, 0.66, 0.64), 0.85, 2, 8)
    assert len(selected) == 5


def test_relative_selection_caps_at_the_maximum():
    selected = rag_service.select_by_relative_score(_scored(*([0.7] * 10)), 0.85, 2, 8)
    assert len(selected) == 8


def test_relative_selection_handles_fewer_candidates_than_the_minimum():
    assert len(rag_service.select_by_relative_score(_scored(0.9), 0.85, 2, 8)) == 1
    assert rag_service.select_by_relative_score([], 0.85, 2, 8) == []


def test_adaptive_selection_fetches_the_pool_and_reports_what_it_kept(monkeypatch):
    pools = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        pools.append(top_k)
        return _scored(0.82, 0.51, 0.48, 0.45)

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    response = rag_service.answer("What is the conveyor speed?", object())

    assert pools == [10]
    assert len(response["citations"]) == 2
    assert response["retrieval"]["selection"] == "adaptive"
    assert response["retrieval"]["candidates"] == 4
    assert response["retrieval"]["selected"] == 2


def test_tiered_selection_still_guesses_the_count_from_complexity(monkeypatch):
    pools = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        pools.append(top_k)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    with rag_config.override(selection="tiered"):
        response = rag_service.answer("What is the conveyor speed?", object())

    assert pools == [rag_service.TIER_PARAMS[response["complexity"]["tier"]]["top_k"]]
    assert response["retrieval"]["selection"] == "tiered"


def test_compact_history_shortens_earlier_answers_in_the_answer_prompt(monkeypatch):
    monkeypatch.setattr(
        rag_service, "retrieve_chunks", lambda q, db, top_k, project_id=None, include_general=False: retrieved()
    )
    _stub_context(monkeypatch)
    prompts = _stub_generate(monkeypatch)
    long_answer = "Samo Susa is 20 years old. He lives in Slovenia and studies software engineering."

    rag_service.answer("What are his hobbies?", object(), history=[("Is Samo Susa 20 years old?", long_answer)])

    answer_prompt = prompts[-1].split("Documentation:")[0]
    assert "Answer: Samo Susa is 20 years old." in answer_prompt
    assert "lives in Slovenia" not in answer_prompt


def test_answer_falls_back_to_the_literal_question_when_the_rewrite_finds_nothing(monkeypatch):
    """A rewrite is a guess. If the corpus does not recognise it but does recognise what
    the user actually typed, the user's words win - silently searching a hallucinated
    rewrite is how a follow-up returns a confident answer about the wrong document."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return [] if query == "What are Samo Susa's hobbies?" else retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch)

    with rag_config.override(fusion="fallback"):
        response = rag_service.answer(
            "What are his hobbies?",
            object(),
            history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
        )

    assert captured_queries == ["What are Samo Susa's hobbies?", "What are his hobbies?"]
    assert response["search"]["query"] == "What are his hobbies?"
    assert response["search"]["rewritten"] is False
    assert response["not_found"] is False


def test_answer_keeps_the_users_question_when_the_rewrite_is_unusable(monkeypatch):
    """An empty or truncated rewrite must not become the search query."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    _stub_generate(monkeypatch, rewrite="")

    response = rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    assert captured_queries == ["What are his hobbies?"]
    assert response["search"]["rewritten"] is False
    assert response["search"]["reason"] == "rewrite rejected as unusable"


def test_answer_without_history_uses_bare_question_for_retrieval(monkeypatch):
    """No history (first turn, or history-less callers) must retrieve on the literal
    question with nothing prefixed - guards against _expand_retrieval_query changing
    behavior for every existing caller that doesn't pass history."""
    captured_queries = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False):
        captured_queries.append(query)
        return retrieved()

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    rag_service.answer("What is the speed?", object())

    assert captured_queries == ["What is the speed?"]


def test_answer_prompt_includes_history_for_pronoun_resolution(monkeypatch):
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    prompts = _stub_generate(monkeypatch)

    rag_service.answer(
        "What are his hobbies?",
        object(),
        history=[("Is Samo Susa 20 years old?", "Yes, Samo Susa is 20 years old.")],
    )

    # prompts[-1] is the answer prompt: a follow-up now also produces a rewrite prompt
    # first, and the two are deliberately formatted differently.
    answer_prompt = prompts[-1]
    assert "Question: Is Samo Susa 20 years old?" in answer_prompt
    assert "Answer: Yes, Samo Susa is 20 years old." in answer_prompt
    # Generation still receives the user's own words - only retrieval sees the rewrite.
    assert "Question: What are his hobbies?\nAnswer:" in answer_prompt


def test_answer_prompt_leaves_history_out_for_a_standalone_question(monkeypatch):
    """History is only there to resolve pronouns. A question with none gets a clean prompt,
    so a small model has no earlier answer - least of all an earlier refusal - to copy."""
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    prompts = _stub_generate(monkeypatch)

    rag_service.answer(
        "How is the cat doing?",
        object(),
        history=[("How is the cat doing?", "I don't have any information about a cat.")],
    )

    assert len(prompts) == 1  # no rewrite either - the question already stands alone
    assert "Earlier in this conversation" not in prompts[0]
    assert "I don't have any information about a cat." not in prompts[0]


def test_a_turn_that_found_nothing_reaches_the_rewriter_but_not_the_answer_prompt(monkeypatch):
    """Its question says what "it" is; its missing answer has nothing to teach the model."""
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: retrieved(),
    )
    _stub_context(monkeypatch)
    prompts = _stub_generate(monkeypatch, rewrite="How is the cat doing now?")

    rag_service.answer(
        "How is it doing now?",
        object(),
        history=[("Who is Samo Susa?", "A software developer."), ("How is the cat doing?", "")],
    )

    rewrite_prompt, answer_prompt = prompts
    assert "User asked about: cat" in rewrite_prompt
    assert "How is the cat doing?" not in answer_prompt.split("Documentation:")[0]
    assert "Question: Who is Samo Susa?" in answer_prompt


def test_answer_drops_history_before_evidence_when_tight_on_context(monkeypatch):
    """Evidence chunks answer the question; history only helps phrasing. Under budget
    pressure the oldest history turn must go first, before any retrieved chunk is cut."""
    chunks = retrieved()
    history = [
        ("Is Samo Susa 20 years old and does he live in Slovenia?", "Yes to both, according to his CV on file.")
    ]
    question = "What are his hobbies?"

    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda q, db, top_k, project_id=None, include_general=False: chunks,
    )
    monkeypatch.setattr(rag_service.llm_adapter, "count_tokens", lambda text: len(text.split()))
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    # Derive the budget boundary from real measured prompt sizes rather than hand-counting
    # words: n_ctx is picked so it comfortably fits the chunk alone, but not the chunk plus
    # history - so dropping history (and only history) should make the prompt fit.
    tokens_without_history = len(rag_service.build_prompt(question, chunks, None).split())
    max_tokens = 10
    n_ctx = tokens_without_history + max_tokens + rag_service.CONTEXT_SAFETY_MARGIN + 2
    monkeypatch.setattr(rag_service.llm_adapter, "context_size", lambda: n_ctx)

    tokens_with_history = len(rag_service.build_prompt(question, chunks, history).split())
    assert tokens_with_history > n_ctx - max_tokens - rag_service.CONTEXT_SAFETY_MARGIN  # sanity: doesn't fit as-is

    response = rag_service.answer(question, object(), max_tokens=max_tokens, history=history)

    assert response["context"]["history_turns_dropped"] == 1
    assert response["context"]["chunks_dropped"] == 0
    assert response["context"]["fits"] is True
    assert len(response["citations"]) == 1


def test_answer_drops_weakest_chunks_to_fit_context(monkeypatch):
    chunks = [
        SimpleNamespace(
            score=0.9,
            chunk=SimpleNamespace(text="short strong chunk", section="A", page=1),
            document=SimpleNamespace(id=1, title="Guide"),
        ),
        SimpleNamespace(
            score=0.5,
            chunk=SimpleNamespace(text="weaker chunk padding " * 20, section="B", page=2),
            document=SimpleNamespace(id=1, title="Guide"),
        ),
    ]
    monkeypatch.setattr(
        rag_service,
        "retrieve_chunks",
        lambda question, db, top_k, project_id=None, include_general=False: chunks,
    )
    # Tiny context window forces the second (weaker) chunk to be dropped.
    _stub_context(monkeypatch, n_ctx=80)
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "answer")

    response = rag_service.answer("Question", object())

    assert response["context"]["chunks_dropped"] == 1
    assert len(response["citations"]) == 1
    assert response["citations"][0]["score"] == 0.9

def _chunk(doc_id, title, index, score, text="text"):
    return SimpleNamespace(
        score=score,
        chunk=SimpleNamespace(text=text, section=None, page=1, chunk_index=index),
        document=SimpleNamespace(id=doc_id, title=title),
    )


def _stub_focus_retrieval(monkeypatch, everywhere, in_focus):
    """Corpus-wide search returns `everywhere`; a search narrowed to doc_ids returns
    `in_focus`. Records the doc_ids each call was narrowed to."""
    calls = []

    def fake_retrieve(query, db, top_k, project_id=None, include_general=False, doc_ids=None):
        calls.append(doc_ids)
        return list(in_focus if doc_ids else everywhere)[:top_k]

    monkeypatch.setattr(rag_service, "retrieve_chunks", fake_retrieve)
    _stub_context(monkeypatch)
    return calls


def test_a_follow_up_keeps_the_previous_answers_document_in_the_evidence(monkeypatch):
    """"And its battery voltage?" says nothing about which forklift. Corpus-wide, a similar
    document outscores the one the conversation is about; the previous answer's document
    must still get its share of the evidence."""
    calls = _stub_focus_retrieval(
        monkeypatch,
        everywhere=[_chunk(2, "Pallet truck manual", 0, 0.62), _chunk(3, "Crane manual", 0, 0.58),
                    _chunk(1, "Forklift manual", 0, 0.55)],
        in_focus=[_chunk(1, "Forklift manual", 4, 0.57), _chunk(1, "Forklift manual", 0, 0.55)],
    )
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "48 V.")

    response = rag_service.answer(
        "And its battery voltage?", object(), top_k=3,
        history=[("How often is the forklift inspected?", "Before every shift.")],
        focus_doc_ids=[1],
    )

    assert calls[-1] == {1}
    # Listed first, so it is still the top source - and the focus - for the next follow-up.
    assert [(c["doc_id"], c["score"]) for c in response["citations"]] == [(1, 0.57), (1, 0.55), (2, 0.62)]


def test_a_standalone_question_is_not_pulled_back_to_the_previous_document(monkeypatch):
    calls = _stub_focus_retrieval(
        monkeypatch,
        everywhere=[_chunk(3, "Crane manual", 0, 0.8)],
        in_focus=[_chunk(1, "Forklift manual", 0, 0.5)],
    )
    monkeypatch.setattr(rag_service.llm_adapter, "generate", lambda prompt, max_tokens: "Hand signals.")

    response = rag_service.answer(
        "Which signals does the crane operator use?", object(),
        history=[("How often is the forklift inspected?", "Before every shift.")],
        focus_doc_ids=[1],
    )

    assert calls == [None]
    assert [c["doc_id"] for c in response["citations"]] == [3]


def test_keep_focus_gives_the_focus_document_half_the_slots_first_without_duplicates():
    everywhere = [_chunk(2, "B", 0, 0.9), _chunk(1, "A", 0, 0.8), _chunk(3, "C", 0, 0.7), _chunk(4, "D", 0, 0.6)]
    in_focus = [_chunk(1, "A", 0, 0.8), _chunk(1, "A", 1, 0.5), _chunk(1, "A", 2, 0.4)]

    kept = rag_service._keep_focus(everywhere, in_focus, top_k=4)

    assert [(c.document.id, c.chunk.chunk_index) for c in kept] == [(1, 0), (1, 1), (2, 0), (3, 0)]


def test_keep_focus_lets_go_once_another_document_clearly_wins():
    """"What about the other model?" is phrased as a follow-up but names a new subject: the
    old document's best match falls well behind, and the conversation moves with it."""
    everywhere = [_chunk(5, "Other model", 0, 0.74), _chunk(6, "Unrelated", 0, 0.54)]
    in_focus = [_chunk(1, "Previous model", 0, 0.45)]

    assert rag_service._keep_focus(everywhere, in_focus, top_k=3) == everywhere


def test_keep_focus_holds_through_a_near_tie():
    everywhere = [_chunk(2, "Similar manual", 0, 0.66), _chunk(1, "Focus manual", 0, 0.57)]
    in_focus = [_chunk(1, "Focus manual", 3, 0.57), _chunk(1, "Focus manual", 0, 0.57)]

    kept = rag_service._keep_focus(everywhere, in_focus, top_k=3)

    assert kept[0].document.id == 1
