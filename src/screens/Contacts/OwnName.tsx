import {observer} from 'mobx-react-lite'
import React, {FC, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {Text as RNText, TextStyle, View, ViewStyle, InteractionManager, TextInput, ScrollView } from 'react-native'
import {colors, spacing, typography, useThemeColor} from '../../theme'
import {BottomModal, Button, Card, ErrorModal, Icon, InfoModal, ListItem, Loading, Screen, Text} from '../../components'
import {useStores} from '../../models'
import { MinibitsClient} from '../../services'
import AppError, { Err } from '../../utils/AppError'
import {log} from '../../utils/logger'
import { TransactionStatus } from '../../models/Transaction'
import { poller, stopPolling } from '../../utils/poller'
import QRCode from 'react-native-qrcode-svg'
import { ResultModalInfo } from '../Wallet/ResultModalInfo'
import { MINIBITS_NIP05_DOMAIN } from '@env'
import { useFocusEffect } from '@react-navigation/native'


export const OwnName = observer(function (props: {navigation: any, pubkey: string}) { 
    // const navigation = useNavigation() 
    const ownNameInputRef = useRef<TextInput>(null)
    const {userSettingsStore, proofsStore, walletProfileStore} = useStores()
    const {pubkey, navigation} = props 
    
    const [ownName, setOwnName] = useState<string>('')
    const [info, setInfo] = useState('')        
    const [availableBalance, setAvailableBalance] = useState(0)
    const [donationAmount, setDonationAmount] = useState(100)
    const [donationInvoice, setDonationInvoice] = useState<{payment_hash: string, payment_request: string} | undefined>(undefined)
    const [isLoading, setIsLoading] = useState(false)
    const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false)
    const [isQRcodeVisible, setIsQRCodeVisible] = useState(false)
    const [isChecked, setIsChecked] = useState(false)
    const [isPaidFromWallet, setIsPaidFromWallet] = useState(false)
    const [isResultModalVisible, setIsResultModalVisible] = useState<boolean>(false)
    const [resultModalInfo, setResultModalInfo] = useState<
      {status: TransactionStatus, message: string} | undefined
    >()
    const [error, setError] = useState<AppError | undefined>()

    useEffect(() => {
        const load = async () => { 
            const maxBalance = proofsStore.getMintBalanceWithMaxBalance()
            if(maxBalance && maxBalance.balance > 0) {
                setAvailableBalance(maxBalance.balance)
            }            
        }
        load()
        return () => {}        
    }, [])


    useLayoutEffect(() => {
        ownNameInputRef && ownNameInputRef.current
        ? ownNameInputRef.current.focus()
        : false
    })


    useEffect(() => {        
        const initPoller = async () => { 
            if(!donationInvoice || !ownName) {
                return
            }

            poller('checkDonationPaidPoller', checkDonationPaid, 6 * 1000, 50, 5) // 5 min
            .then(() => log.trace('Polling completed', {}, 'checkDonationPaid'))
            .catch(error =>
                log.trace(error.message, {}, 'checkPendingTopups'),
            )
           
        }
        initPoller()
        return () => {
            stopPolling('checkDonationPaidPoller')
        }        
    }, [donationInvoice])



    const togglePaymentModal = () =>
        setIsPaymentModalVisible(previousState => !previousState)
    const toggleResultModal = () =>
        setIsResultModalVisible(previousState => !previousState)


    const resetState = function () {        
        setOwnName('')
        setInfo('')
        setIsLoading(false)
        setIsChecked(false)
        setIsPaymentModalVisible(false)
        setDonationInvoice(undefined)
        setDonationAmount(1000)
        setIsResultModalVisible(false)
        setIsQRCodeVisible(false)
        setIsPaidFromWallet(false)
        // stopPolling('checkDonationPaidPoller') // ??
    }


    const onOwnNameChange = function (name: string) {   
        const filtered = name.replace(/[^\w.-_]/g, '') 
        const lowercase = filtered.toLowerCase()    
        setOwnName(lowercase)
    }
  
    
    const onOwnNameCheck = async function () {
        if(!ownName) {
            setInfo('Write your wallet profile name to the text box.')
            return
        }

        try {            
            const profileExists = await MinibitsClient.getWalletProfileByWalletId(ownName)

            if(profileExists) {
                setInfo('This wallet profile name is already used, choose another one.')
                return
            }
            setIsChecked(true)
            setIsPaymentModalVisible(true)
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onCreateDonation = async function () {
        try {
            setIsLoading(true)
            const memo = `Donation for ${ownName+MINIBITS_NIP05_DOMAIN}`
            const invoice = await MinibitsClient.createDonation(
                donationAmount, 
                memo, 
                pubkey
            )

            if(invoice) {
                setDonationInvoice(invoice)
            }

            setIsLoading(false)
            
        } catch (e: any) {
            handleError(e)
        }  
    }


    const onPayDonation = async function () {
        try {            
            setIsPaidFromWallet(true)            
            return navigation.navigate('WalletNavigator', { 
                screen: 'Transfer',
                params: { donationEncodedInvoice: donationInvoice?.payment_request},
            })
           
        } catch (e: any) {
            handleError(e)
        }  
    }


    const checkDonationPaid = async function () {   
        try {
            if(!donationInvoice) {
                return
            }
            
            const { paid } = await MinibitsClient.checkDonationPaid(
                donationInvoice?.payment_hash as string,
                pubkey as string
            )

            if(paid) {                
                setIsLoading(true)
                    
                await walletProfileStore.update(ownName, walletProfileStore.picture)                                    
                userSettingsStore.setWalletId(ownName)

                setIsLoading(false)
                setResultModalInfo({
                    status: TransactionStatus.COMPLETED, 
                    message: `Thank you! Donation for ${ownName+MINIBITS_NIP05_DOMAIN} has been successfully paid.`
                })
                toggleResultModal()
                togglePaymentModal()
                stopPolling('checkDonationPaidPoller')
                return
            }
        } catch (e: any) {
            return false // silent
        }  
    }

    const onResultModalClose = async function () {
        resetState()
        navigation.goBack()
    }


    const handleError = function (e: AppError): void {        
        resetState()
        setError(e)
    }
    
    // TODO refactor whole below mess
    
    const headerBg = useThemeColor('header')
    const hint = useThemeColor('textDim')
    const currentNameColor = colors.palette.primary200
    const inputBg = useThemeColor('background')
    const two = 200
    const five = 500
    const ten = 1000
    const invoiceBg = useThemeColor('background')
    const invoiceTextColor = useThemeColor('textDim')
    const domainText = useThemeColor('textDim')
    
    return (
      <Screen style={$screen} preset='auto'>
        <View style={$contentContainer}>            
            <Card
                style={[$card, {marginTop: spacing.small}]}
                heading='Choose your own name'
                headingStyle={{textAlign: 'center'}}
                ContentComponent={                                
                <View style={$ownNameContainer}>
                    <TextInput
                        ref={ownNameInputRef}
                        onChangeText={(name) => onOwnNameChange(name)}                        
                        value={`${ownName}`}
                        style={[$ownNameInput, {backgroundColor: inputBg}]}
                        maxLength={16}
                        keyboardType="default"
                        selectTextOnFocus={true}
                        // placeholder="Write your wallet name"
                        autoCapitalize="none"
                        editable={
                            isChecked
                            ? false
                            : true
                        }
                    />
                    <View style={[$ownNameDomain, { backgroundColor: inputBg}]}>
                        <Text size='xxs' style={{color: domainText}} text={MINIBITS_NIP05_DOMAIN}/>
                    </View>                 
                    <Button
                        preset="default"
                        style={$ownNameButton}
                        text="Check"
                        onPress={onOwnNameCheck}
                        disabled={
                            isChecked
                            ? true
                            : false
                        }
                    />                    
                </View>                
                }
                footer={'Use lowercase letters, numbers and .-_' }
                footerStyle={{color: hint, textAlign: 'center'}}
            />         
        </View>
        <BottomModal
          isVisible={isPaymentModalVisible ? true : false}
          top={spacing.screenHeight * 0.18}
          ContentComponent={
            <View style={$bottomModal}>
                <View style={$iconContainer}>
                    <Icon icon='faBurst' size={50} color={colors.palette.accent400} />
                </View>
                <View style={{alignItems: 'center'}}>
                    <Text
                        text={`${ownName} is available!`}
                        style={{fontSize: 18}}   
                    />
                    {donationInvoice ? (
                    <>
                    <Text 
                        text={`Pay the following lightning invoice and get your ${ownName+MINIBITS_NIP05_DOMAIN} wallet profile.`}
                        style={[$supportText, {color: hint}]} 
                    />
                    {isQRcodeVisible ? (
                        <View style={{borderWidth: spacing.medium, borderColor: 'white'}}>
                            <QRCode 
                                size={spacing.screenWidth - spacing.huge * 3} 
                                value={donationInvoice.payment_request} 
                            />
                        </View>
                    ) : (
                        <ScrollView
                            style={[
                            $invoiceContainer,
                            {backgroundColor: invoiceBg, marginHorizontal: spacing.small},
                            ]}>
                            <Text
                            selectable
                            text={donationInvoice.payment_request}
                            style={{color: invoiceTextColor, paddingBottom: spacing.medium}}
                            size="xxs"
                            />
                        </ScrollView>
                    )}

                    {(availableBalance > donationAmount) ? (
                        <View style={$payButtonContainer}>                            
                            <Button
                                preset="default"
                                style={{marginRight: spacing.small}}
                                text="Pay from wallet"
                                onPress={onPayDonation}                            
                            />                                                
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />   
                        </View>
                    ) : (
                        <View>
                            <Text                                
                                size='xs'
                                style={{textAlign: 'center', margin: spacing.medium}}
                                text='Your wallet balance is not enough to pay this invoice amount but you can still pay it from another wallet.' 
                            />
                            <View style={$payButtonContainer}>
                            {isQRcodeVisible ? (
                                <Button
                                    preset="default"
                                    style={{marginRight: spacing.small, maxHeight: 50}}                                    
                                    text="Back"
                                    onPress={() => setIsQRCodeVisible(false)}                            
                                />

                            ) : (
                                <Button
                                    preset="default"
                                    style={{marginRight: spacing.small, maxHeight: 50}}
                                    LeftAccessory={() => (
                                        <Icon
                                            icon='faQrcode'
                                            color='white'
                                            size={spacing.small}                                        
                                        />
                                    )}
                                    text="QR code"
                                    onPress={() => setIsQRCodeVisible(true)}                            
                                />
                            )}  
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />
                            </View>                               
                        </View>
                    )}
                    </>
                    ) : (
                    <>
                        <RNText style={$supportText}>                            
                            <Text
                                text='Minibits'
                                style={{fontFamily: 'Gluten-Regular', fontSize: 18}}
                            />{' '}
                            kindly asks you for a small donation for your {ownName+MINIBITS_NIP05_DOMAIN} wallet name.
                        </RNText>
                        <View style={{flexDirection: 'row', justifyContent: 'center'}}>
                            <Text
                                text={`${donationAmount.toLocaleString()}`}
                                preset='heading'    
                            />
                            <Text
                                text={`sats`}
                                style={{fontSize: 18, marginLeft: spacing.extraSmall}}   
                            />
                        </View>
                        <RNText style={$supportText}>
                            Ready to donate more?
                        </RNText>
                        <View style={{flexDirection: 'row', marginBottom: spacing.large}}>
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${two.toLocaleString()}`}
                                onPress={() => setDonationAmount(2000)}                            
                            />
                            <Button
                                preset="secondary"
                                style={{marginRight: spacing.small}}
                                text={`${five.toLocaleString()}`}
                                onPress={() => setDonationAmount(5000)}                            
                            />
                            <Button
                                preset="secondary"                            
                                text={`${ten.toLocaleString()}`}
                                onPress={() => setDonationAmount(10000)}                            
                            />   
                        </View>
                        {(donationAmount === 2000) && (                        
                            <Text text={`♥`}  size='lg' />
                        )}
                        {(donationAmount === 5000) && (                        
                            <Text text={`♥ ♥`}  size='lg' />
                        )}
                        {(donationAmount === 10000) && (                        
                            <Text text={`♥ ♥ ♥`}  size='lg' />
                        )}
                        <View style={[$payButtonContainer, {marginTop: spacing.large}]}>
                            <Button
                                preset="default"
                                style={{marginRight: spacing.small}}
                                text="Get invoice"
                                onPress={onCreateDonation}                            
                            /> 
                            <Button
                                preset="secondary"                            
                                text="Cancel"
                                onPress={resetState}                            
                            />   
                        </View>
                    </>
                    )}

                </View>
                {isLoading && <Loading />}
            </View>
          }
          onBackButtonPress={togglePaymentModal}
          onBackdropPress={togglePaymentModal}
        />
        <BottomModal
          isVisible={isResultModalVisible ? true : false}
          top={spacing.screenHeight * 0.5}
          ContentComponent={            
            <>             
                <ResultModalInfo
                    icon="faCheckCircle"
                    iconColor={colors.palette.success200}
                    title="Success!"
                    message={resultModalInfo?.message as string}
                />
                <View style={$payButtonContainer}>
                <Button
                    preset="secondary"
                    tx={'common.close'}
                    onPress={onResultModalClose}
                />
                </View>
            </>
          }
          onBackButtonPress={onResultModalClose}
          onBackdropPress={onResultModalClose}
        />      
        {error && <ErrorModal error={error} />}
        {info && <InfoModal message={info} />}
      </Screen>
    )
  })



const $screen: ViewStyle = {}


const $contentContainer: TextStyle = {    
    padding: spacing.extraSmall,  
}

const $iconContainer: ViewStyle = {
    marginTop: -spacing.large * 2,
    alignItems: 'center',
}

const $supportText: TextStyle = {
    padding: spacing.small,
    textAlign: 'center',
    fontSize: 16,
}

const $card: ViewStyle = {
    marginBottom: 0,
}

const $payButtonContainer: ViewStyle = {    
    // flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.medium,
    // borderWidth: 1,
    // borderColor: 'red'
}

const $ownNameContainer: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.extraSmall,
}

const $ownNameInput: TextStyle = {
    flex: 1,    
    borderTopLeftRadius: spacing.small,
    borderBottomLeftRadius: spacing.small,
    fontSize: 16,
    padding: spacing.small,
    alignSelf: 'stretch',
    textAlignVertical: 'top',
}

const $ownNameDomain: TextStyle = {    
    marginRight: spacing.small,
    borderTopRightRadius: spacing.small,
    borderBottomRightRadius: spacing.small,    
    padding: spacing.extraSmall,
    alignSelf: 'stretch',
    justifyContent: 'center'
    // textAlignVertical: 'center',
}
  
/* const $ownNameInput: TextStyle = {
    flex: 1,
    borderRadius: spacing.small,
    fontSize: 16,
    textAlignVertical: 'center',
    marginRight: spacing.small,    
}*/

const $ownNameButton: ViewStyle = {
    maxHeight: 50,
}


const $invoiceContainer: ViewStyle = {
    borderRadius: spacing.small,
    alignSelf: 'stretch',
    padding: spacing.small,
    maxHeight: 150,
    marginTop: spacing.small,
    marginBottom: spacing.large,
  }

const $bottomModal: ViewStyle = {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.large,
    paddingHorizontal: spacing.small,
}