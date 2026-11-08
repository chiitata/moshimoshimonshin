import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:patient/public_patient_api.dart';
import 'package:patient/public_patient_screen.dart';

void main() {
  for (final validDocument in [true, false]) {
    testWidgets(
      validDocument
          ? 'delivery sends explicit consent with current document and exact scope'
          : 'missing disclosure hash prevents delivery',
      (tester) async {
        Map<String, dynamic>? sent;
        final epoch = Object();
        final client = MockClient((request) async {
          Object response;
          switch (request.url.path) {
            case '/v1/me':
              response = {
                'accountStatus': 'active',
                'emailVerified': true,
                'profileComplete': true,
                'requiredConsents': {'current': true},
              };
            case '/v1/questionnaires':
              response = {
                'questionnaires': [
                  {'questionnaireId': 'synthetic-questionnaire'},
                ],
              };
            case '/v1/questionnaires/synthetic-questionnaire':
              response = {
                'questionnaireId': 'synthetic-questionnaire',
                'revision': {'versionNumber': 2},
              };
            case '/v1/facilities/synthetic-facility':
              response = {
                'facilityId': 'synthetic-facility',
                'displayName': '合成データ施設',
                'verificationStatus': 'verified',
                'receivingEnabled': true,
              };
            case '/v1/public/legal-documents':
              response = {
                'documents': {
                  'hospital_disclosure': {
                    'version': 'synthetic-v2',
                    if (validDocument) 'documentHash': 'synthetic-hash',
                  },
                },
              };
            case '/v1/deliveries':
              sent = jsonDecode(request.body) as Map<String, dynamic>;
              response = {'deliveryId': 'synthetic-delivery'};
            case '/v1/deliveries/synthetic-delivery':
              response = {'status': 'delivered'};
            default:
              fail('Unexpected request path: ${request.url.path}');
          }
          return http.Response(
            jsonEncode(response),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        });
        addTearDown(client.close);
        await tester.pumpWidget(
          MaterialApp(
            home: PublicPatientScreen(
              api: PublicPatientApi(
                origin: 'https://api.example.test',
                client: client,
                tokens: () async => (auth: 'synthetic', appCheck: 'synthetic'),
                session: () => epoch,
              ),
              signIn: (_, _) async {},
              signOut: () async {},
              resetPassword: (_) async {},
              changes: const Stream<void>.empty(),
            ),
          ),
        );
        Future<void> tap(String label) async {
          await tester.ensureVisible(find.text(label));
          await tester.tap(find.text(label));
          await tester.pumpAndSettle();
        }

        await tap('ログイン');
        await tap('過去の問診票を見る');
        await tap('確定済み問診票');
        await tester.enterText(find.byType(TextField), 'synthetic-facility');
        await tap('施設を確認');
        expect(sent, isNull);
        if (validDocument) {
          final button = tester.widget<FilledButton>(
            find.widgetWithText(FilledButton, '同意した施設へ送信'),
          );
          expect(button.onPressed, isNull);
          await tap('氏名・連絡先と持病を一緒に共有する');
          await tap('「合成データ施設」へ、この問診票と選択した情報を送信することに同意します');
          expect(sent, isNull);
          await tap('同意した施設へ送信');
          final scope = {
            'includeProfile': true,
            'includeConfirmedMedications': false,
            'includePrescriptionImages': false,
          };
          expect(sent, {
            'questionnaireId': 'synthetic-questionnaire',
            'questionnaireRevision': 2,
            'facilityId': 'synthetic-facility',
            'shareScope': scope,
            'consent': {
              'accepted': true,
              'documentVersion': 'synthetic-v2',
              'documentHash': 'synthetic-hash',
              'shareScope': scope,
            },
          });
          expect(find.text('施設の受信箱へ届きました'), findsOneWidget);
        } else {
          expect(find.text('同意した施設へ送信'), findsNothing);
          expect(sent, isNull);
          expect(find.textContaining('現在の利用状態では操作できません'), findsOneWidget);
        }
      },
    );
  }

  for (final scenario in [
    'selected answer',
    'skip',
    'limit',
    'uncertain save',
    'uncertain committed',
    'delayed save',
    'matching stale GET',
    'different answer',
    'missing answer',
    'malformed answer',
    'malformed GET',
    'preexisting different answer',
    'preexisting matching answer',
    'session changes between GET and POST',
  ]) {
    testWidgets('public intake $scenario', (tester) async {
      var epoch = Object();
      var changeOnNextSessionCheck = false;
      var allowOneOldSessionCheck = false;
      var intakeRevision = 1;
      var intakeStatus = 'draft';
      var answerSaved = false;
      var answerAttempts = 0;
      var intakeReads = 0;
      Map<String, dynamic>? submittedAnswer;
      final client = MockClient((request) async {
        Object response;
        var statusCode = 200;
        switch (request.url.path) {
          case '/v1/me':
            response = {
              'accountStatus': 'active',
              'emailVerified': true,
              'profileComplete': true,
              'requiredConsents': {'current': true},
            };
          case '/v1/intakes':
            response = {'intakeId': 'synthetic-intake'};
          case '/v1/intakes/synthetic-intake':
            intakeReads++;
            if (scenario == 'session changes between GET and POST' &&
                intakeReads == 4) {
              // Let the GET complete under its original session. The next
              // screen-level session check (before POST) observes the switch.
              allowOneOldSessionCheck = true;
              changeOnNextSessionCheck = true;
            }
            response = {
              'intakeId': 'synthetic-intake',
              'revision': intakeRevision,
              'status': intakeStatus,
              'questions': [
                {
                  'questionId': 'synthetic-question',
                  'questionRevision': 1,
                  'questionText': 'いつからですか？',
                  'stepIndex': 0,
                  'status': answerSaved ? 'answered' : 'active',
                  'options': [
                    {'code': 'TODAY', 'label': '今日から'},
                  ],
                },
              ],
              'answers':
                  (scenario == 'preexisting different answer' ||
                          scenario == 'preexisting matching answer') &&
                      intakeReads == 4
                  ? [
                      {
                        'questionId': 'synthetic-question',
                        'questionRevision': 1,
                        'selectedCodes':
                            scenario == 'preexisting matching answer'
                            ? ['TODAY']
                            : ['OTHER'],
                        'answerState': 'answered',
                        'freeText': scenario == 'preexisting matching answer'
                            ? '同じ回答'
                            : '別の回答',
                      },
                    ]
                  : scenario == 'malformed GET' && intakeReads >= 5
                  ? 'invalid'
                  : answerSaved
                  ? [
                      {
                        'questionId': 'synthetic-question',
                        'questionRevision': 1,
                        'selectedCodes': scenario == 'malformed answer'
                            ? 'not-a-list'
                            : scenario == 'different answer'
                            ? ['OTHER']
                            : ['TODAY'],
                        'answerState': 'answered',
                        'freeText': scenario == 'different answer'
                            ? '別の回答'
                            : '同じ回答',
                      },
                    ]
                  : [],
            };
          case '/v1/intakes/synthetic-intake/symptoms':
            intakeStatus = 'questioning';
            intakeRevision++;
            response = {'intakeRevision': intakeRevision};
          case '/v1/intakes/synthetic-intake/answers':
            answerAttempts++;
            submittedAnswer = jsonDecode(request.body) as Map<String, dynamic>;
            if ([
                  'uncertain save',
                  'uncertain committed',
                  'delayed save',
                  'matching stale GET',
                  'different answer',
                  'missing answer',
                  'malformed answer',
                  'malformed GET',
                ].contains(scenario) &&
                answerAttempts == 1) {
              if (scenario == 'uncertain committed') {
                answerSaved = true;
                intakeStatus = 'review';
                intakeRevision++;
              }
              if (scenario == 'delayed save') {
                // The server commits after the failed response. No client GET
                // can prove whether this has happened yet.
                Future<void>.microtask(() {
                  answerSaved = true;
                  intakeStatus = 'review';
                  intakeRevision++;
                });
              }
              if (scenario == 'matching stale GET') {
                // Even a later matching snapshot is not evidence that this
                // particular POST was accepted at the relevant point in time.
                answerSaved = true;
                intakeStatus = 'review';
                intakeRevision++;
              }
              statusCode = 503;
              response = {'error': 'synthetic failure'};
            } else {
              answerSaved = true;
              intakeStatus = 'review';
              intakeRevision++;
              response = {
                'answerId': 'synthetic-question',
                'intakeRevision': intakeRevision,
              };
            }
          case '/v1/intakes/synthetic-intake/summary':
            response = {
              'summary': {'sections': {}},
            };
          default:
            fail('Unexpected request path: ${request.url.path}');
        }
        return http.Response(
          jsonEncode(response),
          statusCode,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      addTearDown(client.close);
      await tester.pumpWidget(
        MaterialApp(
          home: PublicPatientScreen(
            api: PublicPatientApi(
              origin: 'https://api.example.test',
              client: client,
              tokens: () async => (auth: 'synthetic', appCheck: 'synthetic'),
              session: () {
                if (allowOneOldSessionCheck) {
                  allowOneOldSessionCheck = false;
                  return epoch;
                }
                if (changeOnNextSessionCheck) {
                  changeOnNextSessionCheck = false;
                  epoch = Object();
                }
                return epoch;
              },
            ),
            signIn: (_, _) async {},
            signOut: () async {},
            resetPassword: (_) async {},
            changes: const Stream<void>.empty(),
          ),
        ),
      );
      Future<void> tap(String label) async {
        await tester.ensureVisible(find.text(label));
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
      }

      await tap('ログイン');
      await tap('新しい問診をはじめる');
      await tester.enterText(
        find.byKey(const ValueKey('症状（1〜1000文字）')),
        '合成症状',
      );
      await tap('保存して質問へ進む');
      if (scenario == 'selected answer') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '昨夜から続いています',
        );
        await tap('今日から');
        expect(submittedAnswer?['freeText'], '昨夜から続いています');
        expect(submittedAnswer?['selectedCodes'], ['TODAY']);
      } else if (scenario == 'skip') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '送らない補足',
        );
        await tap('答えたくない');
        expect(submittedAnswer, isNot(contains('freeText')));
        expect(submittedAnswer?['selectedCodes'], isEmpty);
        expect(submittedAnswer?['answerState'], 'skipped');
      } else if (scenario == 'limit') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '😀' * 1001,
        );
        await tap('今日から');
        expect(answerAttempts, 0);
        expect(find.text('入力内容を確認してください。'), findsOneWidget);
      } else if (scenario == 'session changes between GET and POST') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '同じ回答',
        );
        await tap('今日から');
        expect(answerAttempts, 0);
        expect(find.text('ログイン'), findsWidgets);
        expect(find.text('質問 1'), findsNothing);
      } else if (scenario == 'preexisting different answer' ||
          scenario == 'preexisting matching answer') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '同じ回答',
        );
        await tap('今日から');
        expect(answerAttempts, 0);
        expect(find.textContaining('回答の再送や問診の再開はできません'), findsOneWidget);
      } else if (scenario == 'uncertain save') {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '同じ回答',
        );
        await tap('今日から');
        expect(answerAttempts, 1);
        expect(find.textContaining('回答の再送や問診の再開はできません'), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, '今日から'))
              .onPressed,
          isNull,
        );
        expect(find.text('保存状態を確認（再送しません）'), findsNothing);
        expect(find.text('質問 1'), findsOneWidget);
        expect(find.text('ホームへ'), findsOneWidget);
      } else {
        await tester.enterText(
          find.byKey(const ValueKey('回答の補足（任意・2000文字まで）')),
          '同じ回答',
        );
        await tap('今日から');
        expect(answerAttempts, 1);
        expect(find.text('保存状態を確認（再送しません）'), findsNothing);
        expect(find.textContaining('回答の再送や問診の再開はできません'), findsOneWidget);
        expect(find.text('質問 1'), findsOneWidget);
        expect(find.text('送信前に内容を確認'), findsNothing);
        expect(find.text('ホームへ'), findsOneWidget);
        expect(
          intakeReads,
          4,
          reason: 'Do not use GET reconciliation after failure',
        );
        // Attempting any other answer is not a retry path while outcome is
        // uncertain; the UI exposes only the stop/exit navigation.
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, '今日から'))
              .onPressed,
          isNull,
        );
      }
    });
  }
}
