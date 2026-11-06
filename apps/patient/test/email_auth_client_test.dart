import 'package:flutter_test/flutter_test.dart';
import 'package:patient/email_auth_client.dart';

class FakeTransport implements RegistrationTransport {
  int calls = 0;
  int status = 201;
  bool fail = false;
  Map<String, String>? headers;
  Map<String, Object>? body;

  @override
  Future<int> postRegistration({
    required Map<String, String> headers,
    required Map<String, Object> body,
  }) async {
    calls++;
    this.headers = headers;
    this.body = body;
    if (fail) throw StateError('untrusted transport detail');
    return status;
  }
}

class FakeSignIn implements EmailSignIn {
  int calls = 0;
  bool fail = false;
  @override
  Future<void> signIn(String email, String password) async {
    calls++;
    if (fail) throw StateError('untrusted provider detail');
  }
}

void main() {
  late FakeTransport transport;
  late FakeSignIn signIn;
  late EmailAuthClient client;
  const accepted = ConsentSelection(accepted: true, documentVersion: 'v1');
  const consents = {
    'terms_of_service': accepted,
    'privacy_policy_ack': accepted,
    'health_data_collection': accepted,
  };

  setUp(() {
    transport = FakeTransport();
    signIn = FakeSignIn();
    client = EmailAuthClient(
      transport: transport,
      signInProvider: signIn,
      requiredConsentTypes: consents.keys.toSet(),
    );
  });

  Future<void> register({
    Map<String, ConsentSelection> selections = consents,
    String key = 'test-key',
  }) => client.register(
    email: 'person@example.invalid',
    password: 'example123',
    consents: selections,
    idempotencyKey: key,
    appCheckToken: 'test-token',
  );

  test('sends API contract without automatically signing in', () async {
    await register();
    expect(transport.headers, {
      'Idempotency-Key': 'test-key',
      'X-Firebase-AppCheck': 'test-token',
    });
    expect(transport.body!['locale'], 'ja-JP');
    expect((transport.body!['consents'] as Map)['terms_of_service'], {
      'accepted': true,
      'documentVersion': 'v1',
    });
    expect(signIn.calls, 0);
    await client.signIn(
      email: 'person@example.invalid',
      password: 'example123',
    );
    expect(signIn.calls, 1);
  });

  test(
    'rejects missing or denied consent and invalid key without sending',
    () async {
      for (final selection in [
        <String, ConsentSelection>{},
        {
          ...consents,
          'health_data_collection': const ConsentSelection(
            accepted: false,
            documentVersion: 'v1',
          ),
        },
      ]) {
        await expectLater(
          register(selections: selection),
          throwsA(
            isA<EmailAuthException>().having(
              (e) => e.reason,
              'reason',
              EmailAuthFailure.invalidInput,
            ),
          ),
        );
      }
      await expectLater(
        register(key: 'bad key'),
        throwsA(isA<EmailAuthException>()),
      );
      expect(transport.calls, 0);
    },
  );

  test('rejects incomplete or unknown server consent configurations', () {
    for (final required in [
      <String>{},
      {...consents.keys, 'unknown_type'},
    ]) {
      expect(
        () => EmailAuthClient(
          transport: transport,
          signInProvider: signIn,
          requiredConsentTypes: required,
        ),
        throwsA(isA<EmailAuthException>()),
      );
    }
  });

  test('requires newly required known consent without sending', () async {
    client = EmailAuthClient(
      transport: transport,
      signInProvider: signIn,
      requiredConsentTypes: {...consents.keys, 'optional_analytics'},
    );
    await expectLater(register(), throwsA(isA<EmailAuthException>()));
    expect(transport.calls, 0);
  });

  test('does not sign in after a rejected or failed registration', () async {
    transport.status = 412;
    await expectLater(
      register(),
      throwsA(
        isA<EmailAuthException>().having((e) => e.statusCode, 'status', 412),
      ),
    );
    transport.fail = true;
    await expectLater(
      register(),
      throwsA(
        isA<EmailAuthException>().having(
          (e) => e.reason,
          'reason',
          EmailAuthFailure.unavailable,
        ),
      ),
    );
    expect(signIn.calls, 0);
  });

  test('sanitizes provider failures', () async {
    signIn.fail = true;
    await expectLater(
      client.signIn(email: 'person@example.invalid', password: 'example123'),
      throwsA(
        isA<EmailAuthException>().having(
          (e) => e.reason,
          'reason',
          EmailAuthFailure.signInFailed,
        ),
      ),
    );
  });
}
