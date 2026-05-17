module sealedsurvey::submission_registry;

use std::string::String;
use std::vector;
use sui::event;
use sui::object::{Self, UID};
use sui::table::{Self, Table};
use sui::transfer;
use sui::tx_context::{Self, TxContext};

const EFormNotFound: u64 = 0;
const ENotFormOwner: u64 = 1;
const EDuplicateWallet: u64 = 2;
const EDuplicateEmail: u64 = 3;

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
    submitted_wallets: Table<address, bool>,
    submitted_emails: Table<String, bool>,
    seal_readers: Table<vector<u8>, address>,
}

public struct FormRecord has store {
    owner: address,
    form_title: String,
    form_blob_id: String,
    share_slug: String,
    updated_at: String,
    submitted_wallets: Table<address, bool>,
    submitted_emails: Table<String, bool>,
    seal_readers: Table<vector<u8>, address>,
}

public struct SubmissionRegistered has copy, drop {
    form_id: String,
    form_title: String,
    submission_blob_id: String,
    submitter_address: address,
    submitter_email: String,
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
    submitter_email: String,
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
    let sender = tx_context::sender(ctx);
    let is_owner = form.owner == sender;
    let is_submitter = table::contains(&form.seal_readers, _id)
        && *table::borrow(&form.seal_readers, _id) == sender;
    assert!(is_owner || is_submitter, ENotFormOwner);
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
            submitted_wallets: table::new<address, bool>(ctx),
            submitted_emails: table::new<String, bool>(ctx),
            seal_readers: table::new<vector<u8>, address>(ctx),
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
        submitted_wallets: table::new<address, bool>(ctx),
        submitted_emails: table::new<String, bool>(ctx),
        seal_readers: table::new<vector<u8>, address>(ctx),
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
    submitter_email: String,
    seal_ids: vector<vector<u8>>,
    encrypted: bool,
    timestamp: String,
    ctx: &TxContext,
) {
    let sender = tx_context::sender(ctx);
    assert!(!table::contains(&form.submitted_wallets, sender), EDuplicateWallet);
    assert!(!table::contains(&form.submitted_emails, submitter_email), EDuplicateEmail);

    table::add(&mut form.submitted_wallets, sender, true);
    table::add(&mut form.submitted_emails, submitter_email, true);

    let mut i = 0;
    let len = vector::length(&seal_ids);
    while (i < len) {
        let seal_id = *vector::borrow(&seal_ids, i);
        table::add(&mut form.seal_readers, seal_id, sender);
        i = i + 1;
    };

    form.submission_count = form.submission_count + 1;

    event::emit(FormObjectSubmissionRegistered {
        form_object_id: object::id(form),
        form_id: form.form_id,
        submission_id: form.submission_count,
        submission_blob_id,
        submitter_address: sender,
        submitter_email,
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
    registry: &mut Registry,
    form_id: String,
    form_title: String,
    submission_blob_id: String,
    submitter_email: String,
    seal_ids: vector<vector<u8>>,
    encrypted: bool,
    timestamp: String,
    ctx: &mut TxContext,
) {
    assert!(table::contains(&registry.forms, form_id), EFormNotFound);

    let sender = tx_context::sender(ctx);
    let form = table::borrow_mut(&mut registry.forms, form_id);
    assert!(!table::contains(&form.submitted_wallets, sender), EDuplicateWallet);
    assert!(!table::contains(&form.submitted_emails, submitter_email), EDuplicateEmail);

    table::add(&mut form.submitted_wallets, sender, true);
    table::add(&mut form.submitted_emails, submitter_email, true);

    let mut i = 0;
    let len = vector::length(&seal_ids);
    while (i < len) {
        let seal_id = *vector::borrow(&seal_ids, i);
        table::add(&mut form.seal_readers, seal_id, sender);
        i = i + 1;
    };

    event::emit(SubmissionRegistered {
        form_id,
        form_title,
        submission_blob_id,
        submitter_address: sender,
        submitter_email,
        encrypted,
        timestamp,
    });
}
