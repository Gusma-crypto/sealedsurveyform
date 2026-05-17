module sealedsurvey::submission_registry;

use std::string::String;
use sui::event;
use sui::object::{Self, UID};
use sui::table::{Self, Table};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const EFormNotFound: u64 = 0;
const ENotFormOwner: u64 = 1;

public struct Registry has key {
    id: UID,
    owner: address,
    forms: Table<String, FormRecord>,
}

public struct FormObject has key {
    id: UID,
    owner: address,
    form_id: String,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    submission_count: u64,
}

public struct FormRecord has store {
    owner: address,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    updated_at: String,
}

public struct SubmissionRegistered has copy, drop {
    form_id: String,
    form_title: String,
    submission_blob_id: String,
    submitter_address: address,
    encrypted: bool,
    timestamp: String,
}

public struct FormUpserted has copy, drop {
    form_id: String,
    form_title: String,
    form_blob_id: String,
    owner: address,
    share_slug: String,
    timestamp: String,
}

public struct FormObjectUpserted has copy, drop {
    form_object_id: object::ID,
    form_id: String,
    form_title: String,
    form_blob_id: String,
    owner: address,
    share_slug: String,
    timestamp: String,
}

public struct FormObjectSubmissionRegistered has copy, drop {
    form_object_id: object::ID,
    form_id: String,
    submission_id: u64,
    submission_blob_id: String,
    submitter_address: address,
    encrypted: bool,
    timestamp: String,
}

public struct SubmissionReviewUpdated has copy, drop {
    form_object_id: object::ID,
    form_id: String,
    submission_id: u64,
    status: u8,
    priority: u8,
    timestamp: String,
}

public fun seal_approve(_id: vector<u8>, registry: &Registry, form_id: String, ctx: &TxContext) {
    assert!(table::contains(&registry.forms, form_id), EFormNotFound);

    let form = table::borrow(&registry.forms, form_id);
    assert!(form.owner == tx_context::sender(ctx), ENotFormOwner);
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry {
        id: object::new(ctx),
        owner: tx_context::sender(ctx),
        forms: table::new<String, FormRecord>(ctx),
    });
}

public fun upsert_form(
    registry: &mut Registry,
    form_id: String,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    timestamp: String,
    ctx: &mut TxContext,
) {
    if (table::contains(&registry.forms, form_id)) {
        let form = table::borrow_mut(&mut registry.forms, form_id);
        assert!(form.owner == tx_context::sender(ctx), ENotFormOwner);
        form.form_title = form_title;
        form.form_blob_id = form_blob_id;
        form.share_slug = share_slug;
        form.updated_at = timestamp;
    } else {
        table::add(&mut registry.forms, form_id, FormRecord {
            owner: tx_context::sender(ctx),
            form_title,
            form_blob_id,
            share_slug,
            updated_at: timestamp,
        });
    };

    event::emit(FormUpserted {
        form_id,
        form_title,
        form_blob_id,
        owner: tx_context::sender(ctx),
        share_slug,
        timestamp,
    });
}

public fun create_form_object(
    form_id: String,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    timestamp: String,
    ctx: &mut TxContext,
) {
    let owner = tx_context::sender(ctx);
    let form = FormObject {
        id: object::new(ctx),
        owner,
        form_id,
        form_title,
        form_blob_id,
        share_slug,
        submission_count: 0,
    };

    event::emit(FormObjectUpserted {
        form_object_id: object::id(&form),
        form_id,
        form_title,
        form_blob_id,
        owner,
        share_slug,
        timestamp,
    });

    transfer::share_object(form);
}

public  fun update_form_object(
    form: &mut FormObject,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    timestamp: String,
    ctx: &TxContext,
) {
    assert!(form.owner == tx_context::sender(ctx), ENotFormOwner);

    form.form_title = form_title;
    form.form_blob_id = form_blob_id;
    form.share_slug = share_slug;

    event::emit(FormObjectUpserted {
        form_object_id: object::id(form),
        form_id: form.form_id,
        form_title,
        form_blob_id,
        owner: form.owner,
        share_slug,
        timestamp,
    });
}

public  fun submit_to_form_object(
    form: &mut FormObject,
    submission_blob_id: String,
    encrypted: bool,
    timestamp: String,
    ctx: &TxContext,
) {
    form.submission_count = form.submission_count + 1;

    event::emit(FormObjectSubmissionRegistered {
        form_object_id: object::id(form),
        form_id: form.form_id,
        submission_id: form.submission_count,
        submission_blob_id,
        submitter_address: tx_context::sender(ctx),
        encrypted,
        timestamp,
    });
}

public  fun set_submission_review(
    form: &FormObject,
    submission_id: u64,
    status: u8,
    priority: u8,
    timestamp: String,
    ctx: &TxContext,
) {
    assert!(form.owner == tx_context::sender(ctx), ENotFormOwner);

    event::emit(SubmissionReviewUpdated {
        form_object_id: object::id(form),
        form_id: form.form_id,
        submission_id,
        status,
        priority,
        timestamp,
    });
}

public fun register_submission(
    _registry: &mut Registry,
    form_id: String,
    form_title: String,
    submission_blob_id: String,
    _submitter_address: String,
    encrypted: bool,
    timestamp: String,
    ctx: &mut TxContext,
) {
    event::emit(SubmissionRegistered {
        form_id,
        form_title,
        submission_blob_id,
        submitter_address: tx_context::sender(ctx),
        encrypted,
        timestamp,
    });
}
